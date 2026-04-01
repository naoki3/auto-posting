import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, accounts, posts } from "@/lib/db";
import { TwitterApi } from "twitter-api-v2";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// カンマ区切りで複数指定可能（例: "Naokyyy3,anotheruser"）
const SOURCE_USERNAMES = (process.env.TECH_SOURCE_ACCOUNTS ?? "sama,karpathy,ylecun")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${process.env.CRON_SECRET?.trim()}`;
}

/**
 * URLのコンテンツを取得する（失敗したらnullを返す）
 */
async function fetchUrlContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    // <title>と<meta description>だけ抽出
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
    const content = [title, desc].filter(Boolean).join(" - ");
    return content.length > 0 ? content.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * 英語ツイートを日本語に翻訳して投稿用テキストを生成
 */
async function translateTweet(text: string): Promise<string> {
  // ツイート内のURLを抽出してコンテンツ取得を試みる
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  const urlContents: string[] = [];
  for (const url of urls) {
    const content = await fetchUrlContent(url);
    if (content) urlContents.push(`[リンク先: ${content}]`);
  }

  const urlContext = urlContents.length > 0
    ? `\n\n【リンク先の内容】\n${urlContents.join("\n")}`
    : "";

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `以下の英語ツイートを日本語に翻訳し、技術情報としてわかりやすく整理してXに投稿する文章を作成してください。${urlContext}

【原文】
${text}

【制約】
- 140文字以内
- 単純な翻訳ではなく、要点を簡潔に要約する
- 専門用語はそのまま使う（補足不要）
- 箇条書きや改行を活用して見やすく
- 絵文字1〜2個
- 関連するハッシュタグを1〜2個末尾につける
- リンク先の内容が取得できた場合はそれも踏まえて要約する
- URLや短縮リンクの内容が不明でもテキスト部分から判断して必ず出力する

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

  const appKey = process.env.TECH_ACCOUNT_APP_KEY;
  const appSecret = process.env.TECH_ACCOUNT_APP_SECRET;
  if (!appKey || !appSecret) {
    return NextResponse.json({ error: "TECH_ACCOUNT_APP_KEY or TECH_ACCOUNT_APP_SECRET is not set" }, { status: 500 });
  }

  const TECH_ACCOUNT_ID = "tech_account";

  try {
    // DBからtech_accountの認証情報を取得
    const techAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.accountId, TECH_ACCOUNT_ID));

    if (techAccounts.length === 0) {
      return NextResponse.json({ error: "tech_account not found in DB. Please insert it manually." }, { status: 500 });
    }
    const { accessToken, accessSecret } = techAccounts[0];

    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });

    // 投稿済みのsourceUrlを取得して重複チェック
    const postedRows = await db
      .select({ sourceUrl: posts.sourceUrl })
      .from(posts)
      .where(eq(posts.theme, "tech"))
      .orderBy(desc(posts.createdAt))
      .limit(200);
    const postedUrls = new Set(postedRows.map((r) => r.sourceUrl));

    const results = [];

    for (const username of SOURCE_USERNAMES) {
      // ユーザーIDを取得
      const userRes = await client.v2.userByUsername(username);
      if (!userRes.data) {
        console.warn(`[tech-post] User @${username} not found, skipping`);
        continue;
      }
      const userId = userRes.data.id;

      // 直近のツイートを取得（リツイート・リプライ除外）
      const timeline = await client.v2.userTimeline(userId, {
        max_results: 10,
        "tweet.fields": ["id", "text", "created_at"],
        exclude: ["retweets", "replies"],
      });

      const tweets = timeline.data.data ?? [];

      // 未投稿のツイートを最大3件取得
      const newTweets = tweets
        .filter((t) => !postedUrls.has(`https://x.com/${username}/status/${t.id}`))
        .slice(0, 3);

      for (const tweet of newTweets) {
        try {
          // URLのみのツイートはスキップ
        const textWithoutUrls = tweet.text.replace(/https?:\/\/\S+/g, "").trim();
        if (textWithoutUrls.length < 10) {
          console.log(`[tech-post] Skipping URL-only tweet: ${tweet.id}`);
          continue;
        }

        const sourceUrl = `https://x.com/${username}/status/${tweet.id}`;

          // 翻訳
          const translated = await translateTweet(tweet.text);
          console.log(`[tech-post] @${username} Translated: "${translated}"`);

          // 投稿（翻訳文 + 元ツイートURL）
          const posted = await client.v2.tweet(`${translated}\n${sourceUrl}`);

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

          postedUrls.add(sourceUrl); // 同一実行内の重複防止
          results.push({ status: "posted", username, tweetId: posted.data.id, translated, sourceUrl });
          console.log(`[tech-post] Posted: ${posted.data.id}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[tech-post] Failed for @${username} tweet ${tweet.id}:`, err);
          results.push({ status: "failed", username, tweetId: tweet.id, error: message });
        }
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
