import { createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { DEFAULT_SESSION_SECRET, type AppConfig } from "../config.js";

export const SESSION_COOKIE_NAME = "kulgo_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(
  token: string,
  secret: string = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
): string {
  const effectiveSecret =
    secret && secret.length > 0 ? secret : DEFAULT_SESSION_SECRET;
  return createHmac("sha256", effectiveSecret)
    .update(token, "utf8")
    .digest("hex");
}

export function computeSessionExpiryIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString();
}

export function setSessionCookie(
  c: Context,
  token: string,
  config: AppConfig,
): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: config.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  setCookie(c, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: config.NODE_ENV === "production",
    maxAge: 0,
  });
}

export function getSessionTokenFromCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}
