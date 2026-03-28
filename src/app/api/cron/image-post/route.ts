import { NextRequest, NextResponse } from "next/server";
import { db, accounts } from "@/lib/db";
import { generateCharacterImage } from "@/lib/image-gen";
import { TwitterApi } from "twitter-api-v2";

export const maxDuration = 60; // Vercel最大60秒

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

    // 画像とツイート文を生成
    const { imageBase64, tweetText } = await generateCharacterImage();

    // X クライアント
    const client = new TwitterApi({
      appKey: process.env.X_API_KEY!,
      appSecret: process.env.X_API_SECRET!,
      accessToken: account.accessToken,
      accessSecret: account.accessSecret,
    });

    // 画像をアップロード（v1.1 media/upload は利用可能）
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });
    console.log(`[image-post] Media uploaded: ${mediaId}`);

    // 画像付きツイートを投稿
    const tweet = await client.v2.tweet(tweetText, {
      media: { media_ids: [mediaId] },
    });
    console.log(`[image-post] Posted tweet: ${tweet.data.id}`);

    return NextResponse.json({
      success: true,
      tweetId: tweet.data.id,
      tweetText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[image-post] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
