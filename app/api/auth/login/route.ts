import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/store";
import { makeSession, cookieOptions, COOKIE } from "@/lib/auth/session";
import { checkLimit, recordFailure, recordSuccess, clientIp } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const lim = checkLimit(ip);
  if (!lim.ok) {
    const mins = Math.ceil(lim.retryAfterS / 60);
    return NextResponse.json(
      { error: `Too many failed attempts. Try again in ~${mins} min.`, retryAfterS: lim.retryAfterS },
      { status: 429, headers: { "Retry-After": String(lim.retryAfterS) } },
    );
  }
  let token = "";
  try {
    token = String((await req.json()).token ?? "");
  } catch {}
  if (!verifyToken(token)) {
    recordFailure(ip);
    return NextResponse.json({ error: "Invalid access token." }, { status: 401 });
  }
  recordSuccess(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, makeSession(), cookieOptions(req.nextUrl.hostname, req.headers.get("x-forwarded-proto")));
  return res;
}
