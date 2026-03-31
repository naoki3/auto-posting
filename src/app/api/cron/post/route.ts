import { NextRequest, NextResponse } from "next/server";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db, accounts, posts, prompts } from "@/lib/db";
import { generateNewsPost } from "@/lib/ai";
import { fetchTopNews } from "@/lib/news";
import { postTweet } from "@/lib/twitter";

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${process.env.CRON_SECRET?.trim()}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // アカウントを取得
    const allAccounts = await db.select().from(accounts).where(eq(accounts.accountId, "ito131913"));
    if (allAccounts.length === 0) {
      return NextResponse.json({ message: "No accounts found" }, { status: 200 });
    }
    const account = allAccounts[0];

    // 過去に投稿済みのURLを取得
    const postedRows = await db
      .select({ sourceUrl: posts.sourceUrl })
      .from(posts)
      .where(isNotNull(posts.sourceUrl))
      .orderBy(desc(posts.createdAt))
      .limit(200);

    const postedUrls = new Set(postedRows.map((r) => r.sourceUrl!));

    // ソースを選択（クエリパラメータ > 環境変数 > デフォルトRSS）
    const source = req.nextUrl.searchParams.get("source") ?? process.env.NEWS_SOURCE ?? "rss";
    console.log(`[cron] News source: ${source}`);

    // ニュースを3件取得
    const articles = await fetchTopNews(postedUrls, 3, source);

    if (articles.length === 0) {
      return NextResponse.json({ message: "No new articles found" }, { status: 200 });
    }

    const results = [];

    for (const article of articles) {
      try {
        // AI で要約＋コメント生成
        const content = await generateNewsPost(article);

        // X に投稿
        const tweet = await postTweet(
          account.accessToken,
          account.accessSecret,
          content
        );

        // DB に保存
        const [savedPost] = await db
          .insert(posts)
          .values({
            content,
            accountId: account.accountId,
            tweetId: tweet.tweetId,
            postedAt: new Date(),
            status: "posted",
            theme: "news",
            sourceUrl: article.url,
          })
          .returning();

        await db.insert(prompts).values({
          prompt: article.title,
          output: content,
          theme: "news",
          postId: savedPost.id,
        });

        results.push({
          status: "posted",
          tweetId: tweet.tweetId,
          title: article.title,
          content,
        });

        console.log(`[cron] Posted news: ${article.title.slice(0, 40)}...`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron] Failed to post article: ${article.title}`, err);
        results.push({ status: "failed", title: article.title, error: message });
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
    console.error("[cron] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
