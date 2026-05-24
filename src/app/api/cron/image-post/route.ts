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

async function handleImagePost(location?: string): Promise<NextResponse> {
  const allAccounts = await db.select().from(accounts).where(eq(accounts.accountId, "ito131913"));
  if (allAccounts.length === 0) {
    return NextResponse.json({ message: "No accounts found" }, { status: 200 });
  }
  const account = allAccounts[0];

  const { imageBase64, tweetText, mimeType } = await generateCharacterImage(location);

  const client = new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: account.accessToken,
    accessSecret: account.accessSecret,
  });

  const imageBuffer = Buffer.from(imageBase64, "base64");
  console.log(`[image-post] Starting media upload, mimeType: ${mimeType}, buffer bytes: ${imageBuffer.byteLength}`);
  let mediaId: string;
  try {
    mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType });
    console.log(`[image-post] Media uploaded: ${mediaId}`);
  } catch (uploadErr) {
    const errDetail = uploadErr instanceof Error
      ? `${uploadErr.message} | ${JSON.stringify((uploadErr as unknown as Record<string, unknown>).data ?? {})}`
      : String(uploadErr);
    console.error(`[image-post] Media upload failed: ${errDetail}`);
    throw uploadErr;
  }

  let tweet: Awaited<ReturnType<typeof client.v2.tweet>>;
  try {
    tweet = await client.v2.tweet({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });
    console.log(`[image-post] Posted tweet: ${tweet.data.id}`);
  } catch (tweetErr) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = tweetErr as any;
    const detail = JSON.stringify({ message: e?.message, code: e?.code, data: e?.data, errors: e?.errors });
    console.error(`[image-post] Tweet post failed: ${detail}`);
    throw tweetErr;
  }

  return NextResponse.json({
    success: true,
    tweetId: tweet.data.id,
    tweetText,
  });
}

/** cronやZapierからGETで呼ぶ場合（ランダムシーン） */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await handleImagePost();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    const detail = { message, code: e?.code, data: e?.data, errors: e?.errors };
    console.error("[image-post] Fatal error:", JSON.stringify(detail));
    return NextResponse.json({ success: false, error: message, detail }, { status: 500 });
  }
}

/**
 * シーンの場所を指定して画像生成する場合はPOSTで呼ぶ
 * Body: { "location": "車" } のように日本語で場所を指定
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const location: string | undefined = body.location;

    return await handleImagePost(location);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = err as any;
    const detail = { message, code: e?.code, data: e?.data, errors: e?.errors };
    console.error("[image-post] Fatal error:", JSON.stringify(detail));
    return NextResponse.json({ success: false, error: message, detail }, { status: 500 });
  }
}
