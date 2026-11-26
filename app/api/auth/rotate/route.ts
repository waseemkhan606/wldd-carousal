import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, rotateToken } from "@/lib/auth/store";
import { makeSession, cookieOptions, COOKIE } from "@/lib/auth/session";
import { checkLimit, recordFailure, clientIp } from "@/lib/auth/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!checkLimit(ip).ok) return NextResponse.json({ error: "Locked out, try later." }, { status: 429 });
  let current = "";
  try {
    current = String((await req.json()).current ?? "");
  } catch {}
  if (!verifyToken(current)) {
    recordFailure(ip);
    return NextResponse.json({ error: "Current token is wrong." }, { status: 401 });
  }
  let next: string;
  try {
    next = rotateToken();
  } catch {
    return NextResponse.json(
      { error: "Token is set via APP_ACCESS_TOKEN; change it in the environment and restart." },
      { status: 409 },
    );
  }
  // all old sessions are dead (epoch bumped); keep this browser signed in with a fresh one
  const res = NextResponse.json({ token: next });
  res.cookies.set(COOKIE, makeSession(), cookieOptions(req.nextUrl.hostname, req.headers.get("x-forwarded-proto")));
  return res;
}
