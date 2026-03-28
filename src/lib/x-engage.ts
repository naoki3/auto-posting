import { TwitterApi } from "twitter-api-v2";

export interface TrendingTweet {
  tweetId: string;
  text: string;
  authorId: string;
  likes: number;
  reposts: number;
}

function getClient(accessToken: string, accessSecret: string) {
  return new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken,
    accessSecret,
  });
}

/**
 * キーワードで人気ツイートを検索する
 * ENGAGE_KEYWORDS 環境変数でカンマ区切りのキーワードを指定可能
 * デフォルト: AI,テクノロジー,経済
 */
export async function searchPopularTweets(
  accessToken: string,
  accessSecret: string,
  limit = 3
): Promise<TrendingTweet[]> {
  const client = getClient(accessToken, accessSecret);

  const keywords = (process.env.ENGAGE_KEYWORDS ?? "AI,テクノロジー,経済")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  // ランダムに1キーワードを選んで検索
  const keyword = keywords[Math.floor(Math.random() * keywords.length)];
  console.log(`[engage] Searching tweets for keyword: ${keyword}`);

  const result = await client.v2.search(`${keyword} lang:ja`, {
    sort_order: "relevancy",
    max_results: 100,
    "tweet.fields": ["public_metrics", "author_id", "reply_settings", "conversation_id"],
    expansions: ["author_id"],
  });

  const tweets = result.data.data ?? [];
  console.log(`[engage] Raw search results: ${tweets.length} tweets`);
  tweets.forEach((t) => console.log(`  - ${t.id}: likes=${t.public_metrics?.like_count} text="${t.text.slice(0, 40)}"`));

  return tweets
    .filter((t) =>
      t.public_metrics &&
      t.reply_settings === "everyone" &&
      t.conversation_id === t.id  // 元ツイートのみ（スレッド途中は除外）
    )
    .sort((a, b) => {
      const scoreA = (a.public_metrics?.like_count ?? 0) + (a.public_metrics?.reply_count ?? 0);
      const scoreB = (b.public_metrics?.like_count ?? 0) + (b.public_metrics?.reply_count ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, limit)
    .map((t) => ({
      tweetId: t.id,
      text: t.text,
      authorId: t.author_id ?? "",
      likes: t.public_metrics?.like_count ?? 0,
      reposts: t.public_metrics?.retweet_count ?? 0,
    }));
}

/**
 * ツイートにいいねする（v2）
 */
export async function likeTweet(
  accessToken: string,
  accessSecret: string,
  tweetId: string
): Promise<void> {
  const client = getClient(accessToken, accessSecret);
  const me = await client.v2.me();
  await client.v2.like(me.data.id, tweetId);
}

/**
 * ツイートをリポストする（v2）
 */
export async function repostTweet(
  accessToken: string,
  accessSecret: string,
  tweetId: string
): Promise<void> {
  const client = getClient(accessToken, accessSecret);
  const me = await client.v2.me();
  await client.v2.retweet(me.data.id, tweetId);
}

/**
 * ツイートにリプライする
 */
export async function replyToTweet(
  accessToken: string,
  accessSecret: string,
  tweetId: string,
  comment: string
): Promise<string> {
  console.log(`[engage] Replying to ${tweetId} with: "${comment}" (${comment.length}chars)`);
  const client = getClient(accessToken, accessSecret);
  try {
    const tweet = await client.v2.reply(comment, tweetId);
    return tweet.data.id;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "data" in err) {
      console.error(`[engage] Reply error data:`, JSON.stringify((err as { data: unknown }).data));
    }
    throw err;
  }
}
