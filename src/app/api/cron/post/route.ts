import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, accounts, posts, prompts } from "@/lib/db";
import { generatePost, getTodayTheme } from "@/lib/ai";
import { postTweet } from "@/lib/twitter";
import { validatePost } from "@/lib/validator";

// Vercel Cron は Authorization ヘッダーで保護する
function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: NextRequest) {
  // 認証チェック
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    accountId: string;
    status: "posted" | "failed" | "skipped";
    error?: string;
    tweetId?: string;
    content?: string;
  }> = [];

  try {
    // 1. 今日のテーマを決定
    const theme = getTodayTheme();
    console.log(`[cron] Today's theme: ${theme}`);

    // 2. アクティブなアカウントを全件取得
    const allAccounts = await db.select().from(accounts);

    if (allAccounts.length === 0) {
      return NextResponse.json(
        { message: "No accounts found", theme },
        { status: 200 }
      );
    }

    // 3. アカウントごとに投稿処理
    for (const account of allAccounts) {
      try {
        // 3-1. AIで投稿文を生成
        const { content, prompt } = await generatePost(theme);
        console.log(
          `[cron] Generated post for ${account.accountId}: ${content.slice(0, 50)}...`
        );

        // 3-2. バリデーション
        const validation = validatePost(content);
        if (!validation.valid) {
          console.warn(
            `[cron] Validation failed for ${account.accountId}:`,
            validation.errors
          );

          // DBにfailレコードを保存
          const [savedPost] = await db
            .insert(posts)
            .values({
              content,
              accountId: account.accountId,
              status: "failed",
              theme,
            })
            .returning();

          await db.insert(prompts).values({
            prompt,
            output: content,
            theme,
            postId: savedPost.id,
          });

          results.push({
            accountId: account.accountId,
            status: "failed",
            error: validation.errors.join(", "),
          });
          continue;
        }

        // 3-3. Xに投稿
        const tweet = await postTweet(
          account.accessToken,
          account.accessSecret,
          content
        );
        console.log(
          `[cron] Posted tweet for ${account.accountId}: ${tweet.tweetId}`
        );

        // 3-4. DBに保存（posts）
        const [savedPost] = await db
          .insert(posts)
          .values({
            content,
            accountId: account.accountId,
            tweetId: tweet.tweetId,
            postedAt: new Date(),
            status: "posted",
            theme,
          })
          .returning();

        // 3-5. プロンプト履歴保存
        await db.insert(prompts).values({
          prompt,
          output: content,
          theme,
          postId: savedPost.id,
        });

        results.push({
          accountId: account.accountId,
          status: "posted",
          tweetId: tweet.tweetId,
          content,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron] Error for account ${account.accountId}:`, err);

        results.push({
          accountId: account.accountId,
          status: "failed",
          error: message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      theme,
      results,
      postedCount: results.filter((r) => r.status === "posted").length,
      failedCount: results.filter((r) => r.status === "failed").length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron] Fatal error:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
