import { NextRequest, NextResponse } from "next/server";
import { db, accounts } from "@/lib/db";
import { searchPopularTweets, likeTweet, repostTweet } from "@/lib/x-engage";

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
    const allAccounts = await db.select().from(accounts);
    if (allAccounts.length === 0) {
      return NextResponse.json({ message: "No accounts found" }, { status: 200 });
    }
    const account = allAccounts[0];

    // 話題のツイートを検索
    const tweets = await searchPopularTweets(
      account.accessToken,
      account.accessSecret
    );

    if (tweets.length === 0) {
      return NextResponse.json({ message: "No tweets found" }, { status: 200 });
    }

    const results = [];

    for (const tweet of tweets) {
      try {
        // いいね（失敗しても続行）
        let likeOk = false;
        try {
          await likeTweet(account.accessToken, account.accessSecret, tweet.tweetId);
          likeOk = true;
        } catch (e) {
          console.warn(`[engage] Like failed for ${tweet.tweetId}:`, e);
        }

        // リポスト（失敗しても続行）
        let repostOk = false;
        try {
          await repostTweet(account.accessToken, account.accessSecret, tweet.tweetId);
          repostOk = true;
        } catch (e) {
          console.warn(`[engage] Repost failed for ${tweet.tweetId}:`, e);
        }

        results.push({
          status: "done",
          originalTweetId: tweet.tweetId,
          likeOk,
          repostOk,
          likes: tweet.likes,
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[engage] Failed for tweet ${tweet.tweetId}:`, err);
        results.push({ status: "failed", tweetId: tweet.tweetId, error: message });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      doneCount: results.filter((r) => r.status === "done").length,
      failedCount: results.filter((r) => r.status === "failed").length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[engage] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
