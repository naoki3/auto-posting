import { NextRequest, NextResponse } from "next/server";
import { db, accounts } from "@/lib/db";
// import { posts, prompts } from "@/lib/db";
// import { generateReplyComment } from "@/lib/ai";
import { searchPopularTweets, likeTweet, repostTweet } from "@/lib/x-engage";
// import { replyToTweet } from "@/lib/x-engage";

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

        // リプライ機能（X APIの制限で403になるため一時無効）
        // let replyTweetId: string | null = null;
        // let comment: string | null = null;
        // if (!likeOk && !repostOk) {
        //   console.warn(`[engage] Skipping reply for ${tweet.tweetId}: both like and repost failed`);
        // } else try {
        //   comment = await generateReplyComment(tweet.text);
        //   replyTweetId = await replyToTweet(account.accessToken, account.accessSecret, tweet.tweetId, comment);
        //   const [savedPost] = await db.insert(posts).values({
        //     content: comment, accountId: account.accountId, tweetId: replyTweetId,
        //     postedAt: new Date(), status: "posted", theme: "engage",
        //     sourceUrl: `https://x.com/i/web/status/${tweet.tweetId}`,
        //   }).returning();
        //   await db.insert(prompts).values({ prompt: tweet.text, output: comment, theme: "engage", postId: savedPost.id });
        // } catch (e) {
        //   console.warn(`[engage] Reply failed for ${tweet.tweetId}:`, e);
        // }

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
