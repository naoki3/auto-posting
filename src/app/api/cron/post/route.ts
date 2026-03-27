import { NextRequest, NextResponse } from "next/server";
import { db, accounts, posts, prompts } from "@/lib/db";
import { generatePost } from "@/lib/ai";
import { fetchAndSaveMetrics, getTopPostYesterday } from "@/lib/analytics";
import { postTweet } from "@/lib/twitter";
import { validatePost } from "@/lib/validator";

// Vercel Cron は Authorization ヘッダーで保護する
function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    accountId: string;
    status: "posted" | "failed" | "skipped";
    strategy?: string;
    error?: string;
    tweetId?: string;
    content?: string;
    topPost?: { likes: number; impressions: number; reposts: number };
  }> = [];

  try {
    // アクティブなアカウントを全件取得
    const allAccounts = await db.select().from(accounts);

    if (allAccounts.length === 0) {
      return NextResponse.json({ message: "No accounts found" }, { status: 200 });
    }

    for (const account of allAccounts) {
      try {
        // 1. 前日の投稿メトリクスをX APIから取得してDBに保存
        try {
          await fetchAndSaveMetrics(
            account.accessToken,
            account.accessSecret,
            account.accountId
          );
          console.log(`[cron] Metrics saved for ${account.accountId}`);
        } catch (err) {
          // メトリクス取得失敗はフォールバックで続行（投稿自体は止めない）
          console.warn(`[cron] Failed to fetch metrics for ${account.accountId}:`, err);
        }

        // 2. 前日のトップ投稿を取得
        const topPost = await getTopPostYesterday(account.accountId);
        if (topPost) {
          console.log(
            `[cron] Top post for ${account.accountId}: score=${topPost.score} likes=${topPost.likes}`
          );
        } else {
          console.log(`[cron] No top post found for ${account.accountId}, using fallback`);
        }

        // 3. AIで今日の投稿を生成（バズ投稿を参考に or フォールバック）
        const { content, prompt, strategy } = await generatePost(topPost);
        console.log(
          `[cron] Generated (${strategy}) for ${account.accountId}: ${content.slice(0, 50)}...`
        );

        // 4. バリデーション
        const validation = validatePost(content);
        if (!validation.valid) {
          console.warn(
            `[cron] Validation failed for ${account.accountId}:`,
            validation.errors
          );

          const [savedPost] = await db
            .insert(posts)
            .values({
              content,
              accountId: account.accountId,
              status: "failed",
              theme: strategy,
            })
            .returning();

          await db.insert(prompts).values({
            prompt,
            output: content,
            theme: strategy,
            postId: savedPost.id,
          });

          results.push({
            accountId: account.accountId,
            status: "failed",
            strategy,
            error: validation.errors.join(", "),
          });
          continue;
        }

        // 5. Xに投稿
        const tweet = await postTweet(
          account.accessToken,
          account.accessSecret,
          content
        );
        console.log(`[cron] Posted tweet for ${account.accountId}: ${tweet.tweetId}`);

        // 6. DBに保存
        const [savedPost] = await db
          .insert(posts)
          .values({
            content,
            accountId: account.accountId,
            tweetId: tweet.tweetId,
            postedAt: new Date(),
            status: "posted",
            theme: strategy,
          })
          .returning();

        await db.insert(prompts).values({
          prompt,
          output: content,
          theme: strategy,
          postId: savedPost.id,
        });

        results.push({
          accountId: account.accountId,
          status: "posted",
          strategy,
          tweetId: tweet.tweetId,
          content,
          ...(topPost && {
            topPost: {
              likes: topPost.likes,
              impressions: topPost.impressions,
              reposts: topPost.reposts,
            },
          }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron] Error for account ${account.accountId}:`, err);
        results.push({ accountId: account.accountId, status: "failed", error: message });
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
