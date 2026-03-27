import { TwitterApi } from "twitter-api-v2";

export interface TweetResult {
  tweetId: string;
  text: string;
}

/**
 * X（Twitter）にツイートを投稿する
 * account_id に紐づくトークンを使う
 */
export async function postTweet(
  accessToken: string,
  accessSecret: string,
  content: string
): Promise<TweetResult> {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("X_API_KEY or X_API_SECRET is not set");
  }

  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });

  const tweet = await client.v2.tweet(content);

  if (!tweet.data?.id) {
    throw new Error("Failed to post tweet: no tweet ID returned");
  }

  return {
    tweetId: tweet.data.id,
    text: tweet.data.text,
  };
}
