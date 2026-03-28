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

  const result = await client.v2.search(keyword, {
    sort_order: "relevancy",
    max_results: 10,
    "tweet.fields": ["public_metrics", "author_id"],
    expansions: ["author_id"],
  });

  const tweets = result.data.data ?? [];

  return tweets
    .filter((t) => t.public_metrics && t.public_metrics.like_count > 0)
    .sort((a, b) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0))
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
 * ツイートにいいねする（v1.1）
 */
export async function likeTweet(
  accessToken: string,
  accessSecret: string,
  tweetId: string
): Promise<void> {
  const client = getClient(accessToken, accessSecret);
  await client.v1.post("favorites/create.json", { id: tweetId });
}

/**
 * ツイートをリポストする（v1.1）
 */
export async function repostTweet(
  accessToken: string,
  accessSecret: string,
  tweetId: string
): Promise<void> {
  const client = getClient(accessToken, accessSecret);
  await client.v1.post(`statuses/retweet/${tweetId}.json`, {});
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
  const tweet = await client.v2.reply(comment, tweetId);
  return tweet.data.id;
}
