import crypto from "node:crypto";
import { getSecret, getEpoch } from "./store";

export const COOKIE = "cs_session";
export const SESSION_TTL_S = 7 * 24 * 3600;

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function makeSession(): string {
  const payload = `${getEpoch()}.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}`;
  return `${payload}.${sign(payload)}`;
}

export function validSession(cookie: string | undefined | null): boolean {
  if (!cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3) return false;
  const [epoch, exp, sig] = parts;
  const want = sign(`${epoch}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return Number(epoch) === getEpoch();
}

export function cookieOptions(hostname: string, _proto: string | null = null) {
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: !local,
    path: "/",
    maxAge: SESSION_TTL_S,
  };
}
