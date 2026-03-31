import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, accounts, posts } from "@/lib/db";
import { TwitterApi } from "twitter-api-v2";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SOURCE_USERNAME = "Naokyyy3";

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${process.env.CRON_SECRET?.trim()}`;
}

/**
 * 英語ツイートを日本語に翻訳して投稿用テキストを生成
 */
async function translateTweet(text: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `以下の英語ツイートを日本語に翻訳して、Xに投稿する文章を作成してください。

【原文】
${text}

【制約】
- 140文字以内
- 自然な日本語・技術情報として分かりやすく
- 絵文字1〜2個
- 関連するハッシュタグを1〜2個末尾につける
- 翻訳・要約であることを示す前置きは不要

投稿文のみ出力してください。`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected AI response type");
  return content.text.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = process.env.TECH_ACCOUNT_ACCESS_TOKEN;
  const accessSecret = process.env.TECH_ACCOUNT_ACCESS_SECRET;
  if (!accessToken || !accessSecret) {
    return NextResponse.json({ error: "TECH_ACCOUNT_ACCESS_TOKEN or TECH_ACCOUNT_ACCESS_SECRET is not set" }, { status: 500 });
  }

  const TECH_ACCOUNT_ID = "tech_account";

  try {
    // 2つ目のアカウントをaccountsテーブルに登録（初回のみ）
    await db
      .insert(accounts)
      .values({ accountId: TECH_ACCOUNT_ID, accessToken, accessSecret })
      .onConflictDoUpdate({
        target: accounts.accountId,
        set: { accessToken, accessSecret },
      });

    const client = new TwitterApi({
      appKey: process.env.X_API_KEY!,
      appSecret: process.env.X_API_SECRET!,
      accessToken,
      accessSecret,
    });

    // @Naokyyy3のユーザーIDを取得
    const userRes = await client.v2.userByUsername(SOURCE_USERNAME);
    if (!userRes.data) {
      return NextResponse.json({ error: `User @${SOURCE_USERNAME} not found` }, { status: 404 });
    }
    const userId = userRes.data.id;

    // 直近のツイートを取得（リツイート・リプライ除外）
    const timeline = await client.v2.userTimeline(userId, {
      max_results: 10,
      "tweet.fields": ["id", "text", "created_at"],
      exclude: ["retweets", "replies"],
    });

    const tweets = timeline.data.data ?? [];
    if (tweets.length === 0) {
      return NextResponse.json({ message: "No tweets found" }, { status: 200 });
    }

    // 投稿済みのsourceUrlを取得して重複チェック
    const postedRows = await db
      .select({ sourceUrl: posts.sourceUrl })
      .from(posts)
      .where(eq(posts.theme, "tech"))
      .orderBy(desc(posts.createdAt))
      .limit(100);
    const postedUrls = new Set(postedRows.map((r) => r.sourceUrl));

    // 未投稿のツイートを最大3件取得
    const newTweets = tweets
      .filter((t) => {
        const url = `https://x.com/${SOURCE_USERNAME}/status/${t.id}`;
        return !postedUrls.has(url);
      })
      .slice(0, 3);

    if (newTweets.length === 0) {
      return NextResponse.json({ message: "No new tweets to translate" }, { status: 200 });
    }

    const results = [];

    for (const tweet of newTweets) {
      try {
        const sourceUrl = `https://x.com/${SOURCE_USERNAME}/status/${tweet.id}`;

        // 翻訳
        const translated = await translateTweet(tweet.text);
        console.log(`[tech-post] Translated: "${translated}"`);

        // 投稿（翻訳文 + 元ツイートURL）
        const postText = `${translated}\n${sourceUrl}`;
        const posted = await client.v2.tweet(postText);

        // DB保存
        await db.insert(posts).values({
          content: translated,
          accountId: TECH_ACCOUNT_ID,
          tweetId: posted.data.id,
          postedAt: new Date(),
          status: "posted",
          theme: "tech",
          sourceUrl,
        });

        results.push({ status: "posted", tweetId: posted.data.id, translated, sourceUrl });
        console.log(`[tech-post] Posted: ${posted.data.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[tech-post] Failed for tweet ${tweet.id}:`, err);
        results.push({ status: "failed", tweetId: tweet.id, error: message });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      postedCount: results.filter((r) => r.status === "posted").length,
      failedCount: results.filter((r) => r.status === "failed").length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tech-post] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
