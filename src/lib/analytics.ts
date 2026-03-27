import { TwitterApi } from "twitter-api-v2";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, analytics, posts } from "@/lib/db";

export interface TopPost {
  content: string;
  tweetId: string;
  likes: number;
  impressions: number;
  reposts: number;
  score: number;
}

/**
 * X API から前日の投稿メトリクスを取得してDBに保存する
 */
export async function fetchAndSaveMetrics(
  accessToken: string,
  accessSecret: string,
  accountId: string
): Promise<void> {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("X_API_KEY or X_API_SECRET is not set");
  }

  // 前日の範囲を計算
  const yesterday = getYesterdayRange();

  // 前日に投稿されたツイートをDBから取得
  const yesterdayPosts = await db
    .select({ id: posts.id, tweetId: posts.tweetId })
    .from(posts)
    .where(
      and(
        eq(posts.accountId, accountId),
        eq(posts.status, "posted"),
        gte(posts.postedAt, yesterday.start),
        lt(posts.postedAt, yesterday.end)
      )
    );

  if (yesterdayPosts.length === 0) return;

  const tweetIds = yesterdayPosts
    .map((p) => p.tweetId)
    .filter((id): id is string => id !== null);

  if (tweetIds.length === 0) return;

  // X API v2 でメトリクスを取得
  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });

  const tweetsResult = await client.v2.tweets(tweetIds, {
    "tweet.fields": ["public_metrics"],
  });

  if (!tweetsResult.data) return;

  // DBに保存
  for (const tweet of tweetsResult.data) {
    const metrics = tweet.public_metrics;
    if (!metrics) continue;

    const matchedPost = yesterdayPosts.find((p) => p.tweetId === tweet.id);
    if (!matchedPost) continue;

    await db.insert(analytics).values({
      postId: matchedPost.id,
      likes: metrics.like_count ?? 0,
      impressions: metrics.impression_count ?? 0,
      reposts: metrics.retweet_count ?? 0,
    });
  }
}

/**
 * 前日のアカウントのトップ投稿を取得する
 * スコア = いいね×3 + リポスト×2 + インプレッション×0.01
 */
export async function getTopPostYesterday(
  accountId: string
): Promise<TopPost | null> {
  const yesterday = getYesterdayRange();

  const rows = await db
    .select({
      content: posts.content,
      tweetId: posts.tweetId,
      likes: analytics.likes,
      impressions: analytics.impressions,
      reposts: analytics.reposts,
      score: sql<number>`(${analytics.likes} * 3 + ${analytics.reposts} * 2 + ${analytics.impressions} * 0.01)`,
    })
    .from(posts)
    .innerJoin(analytics, eq(analytics.postId, posts.id))
    .where(
      and(
        eq(posts.accountId, accountId),
        eq(posts.status, "posted"),
        gte(posts.postedAt, yesterday.start),
        lt(posts.postedAt, yesterday.end)
      )
    )
    .orderBy(
      desc(
        sql`(${analytics.likes} * 3 + ${analytics.reposts} * 2 + ${analytics.impressions} * 0.01)`
      )
    )
    .limit(1);

  if (rows.length === 0 || !rows[0].tweetId) return null;

  return {
    content: rows[0].content,
    tweetId: rows[0].tweetId,
    likes: rows[0].likes,
    impressions: rows[0].impressions,
    reposts: rows[0].reposts,
    score: rows[0].score,
  };
}

function getYesterdayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(now.getUTCDate() - 1);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);

  return { start, end };
}
