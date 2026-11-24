import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Authorizes Vercel Cron / Zapier calls with `Authorization: Bearer <CRON_SECRET>`.
 * Fails closed: if CRON_SECRET is not configured every request is rejected
 * (previously an unset secret accepted the literal header "Bearer undefined").
 */
export function isAuthorized(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "development") return true;

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron-auth] CRON_SECRET is not configured; rejecting request");
    return false;
  }

  const header = req.headers.get("authorization")?.trim() ?? "";
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
