import { NextRequest, NextResponse } from "next/server";
import { db, accounts, posts, prompts } from "@/lib/db";
import { generatePost } from "@/lib/ai";
import { getTopPostYesterday } from "@/lib/analytics";
import { validatePost } from "@/lib/validator";

function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;
  const authHeader = req.headers.get("authorization")?.trim();
  const querySecret = req.nextUrl.searchParams.get("secret")?.trim();
  const secret = process.env.CRON_SECRET?.trim();
  return authHeader === `Bearer ${secret}` || querySecret === secret;
}

/**
 * Zapier から呼ばれるエンドポイント
 * 投稿文を生成してDBに保存し、content を返す
 * Zapier がこの content を使って X に投稿する
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // account_id を指定する場合はクエリパラメータで受け取る
  // 例: /api/generate?account_id=ito131913
  const accountId = req.nextUrl.searchParams.get("account_id");

  try {
    // アカウントを取得
    const allAccounts = await db.select().from(accounts);
    if (allAccounts.length === 0) {
      return NextResponse.json({ error: "No accounts found" }, { status: 404 });
    }

    const account = accountId
      ? allAccounts.find((a) => a.accountId === accountId)
      : allAccounts[0];

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // 前日のトップ投稿を取得
    const topPost = await getTopPostYesterday(account.accountId);

    // AI で投稿文を生成
    const { content, prompt, strategy } = await generatePost(topPost);

    // バリデーション
    const validation = validatePost(content);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 422 }
      );
    }

    // DB に保存（status は pending: Zapier が投稿したら posted になる）
    const [savedPost] = await db
      .insert(posts)
      .values({
        content,
        accountId: account.accountId,
        status: "pending",
        theme: strategy,
      })
      .returning();

    await db.insert(prompts).values({
      prompt,
      output: content,
      theme: strategy,
      postId: savedPost.id,
    });

    // Zapier が使う content を返す
    return NextResponse.json({
      content,
      postId: savedPost.id,
      strategy,
      charCount: validation.charCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
