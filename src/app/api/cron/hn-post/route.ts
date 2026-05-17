import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, accounts, posts } from "@/lib/db";
import { TwitterApi } from "twitter-api-v2";
import Anthropic from "@anthropic-ai/sdk";
import { countTweetLength } from "@/lib/validator";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TECH_ACCOUNT_ID = "tech_account";
const HN_FETCH_SIZE = 20;
const CANDIDATE_LIMIT = 5;

interface HNHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  author: string;
  created_at: string;
  num_comments: number;
}

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${process.env.CRON_SECRET?.trim()}`;
}

async function fetchHNTopAI(): Promise<HNHit[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=AI&tags=story&hitsPerPage=${HN_FETCH_SIZE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Algolia HN API error: ${res.status}`);
  const data = (await res.json()) as { hits: HNHit[] };
  return data.hits ?? [];
}

/**
 * 記事URLからタイトルとdescriptionを取得する（失敗時はnull）
 */
async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    const html = await res.text();
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
    const desc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim() ?? "";
    const content = [title, desc].filter(Boolean).join(" - ");
    return content.length > 0 ? content.slice(0, 400) : null;
  } catch {
    return null;
  }
}

/**
 * LLMでAI・Tech関連かバッチ判定し、該当する記事のみ返す
 */
async function filterByAITech(articles: HNHit[]): Promise<HNHit[]> {
  if (articles.length === 0) return [];

  const list = articles.map((a, i) => `${i + 1}. ${a.title}`).join("\n");

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    messages: [
      {
        role: "user",
        content: `以下のHacker Newsの記事タイトルから、AI・機械学習・ソフトウェア・プログラミング・クラウド・セキュリティなどIT技術に関連するものの番号をカンマ区切りで返してください。政治・スポーツ・一般ビジネス・社会ニュースは除外してください。

${list}

番号のみをカンマ区切りで出力してください（例: 1,3,5）。`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") return articles;

  const indices = content.text
    .split(",")
    .map((s: string) => parseInt(s.trim(), 10) - 1)
    .filter((i: number) => i >= 0 && i < articles.length);

  return indices.map((i: number) => articles[i]);
}

/**
 * HN記事からX投稿文を生成（最大3回リトライ）
 */
async function generateHNPost(hit: HNHit, sourceUrl: string, articleContent: string | null): Promise<string> {
  const contentContext = articleContent
    ? `\n【記事の内容】\n${articleContent}`
    : "";

  const prompt = `あなたはIT技術ニュースをわかりやすく伝えるX（旧Twitter）投稿の専門家です。

以下のHacker News記事をもとに、X投稿文を1つ作成してください。${contentContext}

【HNタイトル】${hit.title}
【HNポイント】${hit.points} / コメント数: ${hit.num_comments}

【投稿フォーマット】
1行目〜2行目: 何が起きたか・何が新しいかを噛み砕いて簡潔に（日本語）
最終行: 一言コメント（驚き・注目ポイント・感想）

【制約】
- URL（23文字固定）を末尾に付けるため、本文は90文字以内
- 専門用語はそのまま使ってOK（補足不要）
- 絵文字1〜2個
- 関連するハッシュタグ1〜2個を末尾に

投稿本文のみ出力してください（URLは含めない）。`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const retryNote =
      attempt > 1 ? `\n\n※前回の出力が長すぎました。本文を90文字以内に収めてください。` : "";

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt + retryNote }],
    });

    const raw = message.content[0];
    if (raw.type !== "text") throw new Error("Unexpected AI response type");

    const body = raw.text.trim();
    const full = `${body}\n${sourceUrl}`;

    if (countTweetLength(full) <= 140) {
      return full;
    }

    console.warn(`[hn-post] Attempt ${attempt}: ${countTweetLength(full)} chars, retrying...`);
  }

  throw new Error("Failed to generate HN post within 140 characters after 3 attempts");
}

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appKey = process.env.TECH_ACCOUNT_APP_KEY;
  const appSecret = process.env.TECH_ACCOUNT_APP_SECRET;
  if (!appKey || !appSecret) {
    return NextResponse.json(
      { error: "TECH_ACCOUNT_APP_KEY or TECH_ACCOUNT_APP_SECRET is not set" },
      { status: 500 }
    );
  }

  try {
    const techAccounts = await db
      .select()
      .from(accounts)
      .where(eq(accounts.accountId, TECH_ACCOUNT_ID));

    if (techAccounts.length === 0) {
      return NextResponse.json(
        { error: "tech_account not found in DB. Please insert it manually." },
        { status: 500 }
      );
    }
    const { accessToken, accessSecret } = techAccounts[0];

    const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });

    // 1. Algolia HN API でAI人気20件取得
    const rawHits = await fetchHNTopAI();
    console.log(`[hn-post] Fetched ${rawHits.length} hits from Algolia HN`);

    // 2. URL重複除外（DB投稿済み + 同バッチ内）
    const postedRows = await db
      .select({ sourceUrl: posts.sourceUrl })
      .from(posts)
      .where(eq(posts.theme, "hn"))
      .orderBy(desc(posts.createdAt))
      .limit(500);

    const postedUrls = new Set<string>(
      postedRows.map((r) => r.sourceUrl).filter((u): u is string => u !== null)
    );

    const seenUrls = new Set<string>(postedUrls);
    const dedupByUrl = rawHits.filter((h) => {
      const url = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (seenUrls.has(url)) return false;
      seenUrls.add(url);
      return true;
    });
    console.log(`[hn-post] After URL dedup: ${dedupByUrl.length}`);

    // 4. LLMでAI・Tech関連か判定
    const filtered = await filterByAITech(dedupByUrl);
    console.log(`[hn-post] After LLM filter: ${filtered.length}`);

    // 5. ポイント降順で上位5件を投稿候補にする
    const candidates = filtered.sort((a, b) => b.points - a.points).slice(0, CANDIDATE_LIMIT);
    console.log(`[hn-post] Candidates: ${candidates.length}`);

    // 6. 記事コンテンツを並列取得してから順番に投稿
    const articleContents = await Promise.all(
      candidates.map((h) => (h.url ? fetchArticleContent(h.url) : Promise.resolve(null)))
    );

    const results = [];
    for (let i = 0; i < candidates.length; i++) {
      const hit = candidates[i];
      const sourceUrl = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
      try {
        const postText = await generateHNPost(hit, sourceUrl, articleContents[i]);
        console.log(`[hn-post] Generated: "${postText}"`);

        const posted = await client.v2.tweet(postText);

        await db.insert(posts).values({
          content: postText,
          accountId: TECH_ACCOUNT_ID,
          tweetId: posted.data.id,
          postedAt: new Date(),
          status: "posted",
          theme: "hn",
          sourceUrl,
        });

        results.push({
          status: "posted",
          objectID: hit.objectID,
          title: hit.title,
          points: hit.points,
          tweetId: posted.data.id,
          sourceUrl,
        });
        console.log(`[hn-post] Posted tweet ${posted.data.id} for objectID ${hit.objectID}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[hn-post] Failed for objectID ${hit.objectID}:`, err);
        results.push({
          status: "failed",
          objectID: hit.objectID,
          title: hit.title,
          points: hit.points,
          sourceUrl,
          error: msg,
        });
      }
    }

    return NextResponse.json({
      success: true,
      pipeline: {
        fetched: rawHits.length,
        afterUrlDedup: dedupByUrl.length,
        afterLLMFilter: filtered.length,
        candidates: candidates.length,
      },
      results,
      postedCount: results.filter((r) => r.status === "posted").length,
      failedCount: results.filter((r) => r.status === "failed").length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[hn-post] Fatal error:", err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
