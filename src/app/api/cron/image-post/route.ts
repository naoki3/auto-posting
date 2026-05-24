import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, accounts } from "@/lib/db";
import { generateCharacterImage } from "@/lib/image-gen";
import { TwitterApi } from "twitter-api-v2";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  return authHeader === `Bearer ${process.env.CRON_SECRET?.trim()}`;
}

async function handleImagePost(photoSource?: string): Promise<NextResponse> {
  const allAccounts = await db.select().from(accounts).where(eq(accounts.accountId, "ito131913"));
  if (allAccounts.length === 0) {
    return NextResponse.json({ message: "No accounts found" }, { status: 200 });
  }
  const account = allAccounts[0];

  const { imageBase64, tweetText } = await generateCharacterImage(photoSource);

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  });

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });
  console.log(`[image-post] Media uploaded: ${mediaId}`);

  const tweet = await client.v2.tweet({
    text: tweetText,
    media: { media_ids: [mediaId] },
  });
  console.log(`[image-post] Posted tweet: ${tweet.data.id}`);

  return NextResponse.json({
    success: true,
    tweetId: tweet.data.id,
    tweetText,
  });
}

/** cronやZapierからGETで呼ぶ場合（デフォルト画像使用） */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleImagePost();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[image-post] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * 写真の場所をリクエストで指定する場合はPOSTで呼ぶ
 * Body: { "photoUrl": "https://..." } または { "photoPath": "/path/to/photo.png" }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const photoSource: string | undefined = body.photoUrl ?? body.photoPath;

    return await handleImagePost(photoSource);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[image-post] Fatal error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
