// Access-token store. Node runtime only (fs + crypto).
// The plain token is never written to disk: only a scrypt hash lives in data/auth.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, ensureDataDir } from "../paths";

const AUTH_FILE = () => path.join(DATA_DIR, "auth.json");
const SECRET_FILE = () => path.join(DATA_DIR, ".secret");

type AuthFile = { salt: string; hash: string; epoch: number };

function scrypt(token: string, salt: Buffer): Buffer {
  return crypto.scryptSync(token, salt, 32, { N: 16384, r: 8, p: 1 });
}

function writePrivate(file: string, data: string) {
  fs.writeFileSync(file, data, { mode: 0o600 });
}

export function getSecret(): Buffer {
  ensureDataDir();
  const f = SECRET_FILE();
  if (!fs.existsSync(f)) writePrivate(f, crypto.randomBytes(32).toString("base64url"));
  return Buffer.from(fs.readFileSync(f, "utf8").trim(), "base64url");
}

function readAuth(): AuthFile | null {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE(), "utf8")) as AuthFile;
  } catch {
    return null;
  }
}

function writeAuth(a: AuthFile) {
  ensureDataDir();
  writePrivate(AUTH_FILE(), JSON.stringify(a));
}

export function envToken(): string | null {
  const t = process.env.APP_ACCESS_TOKEN?.trim();
  return t ? t : null;
}

/** Called once at server boot (instrumentation.ts). Prints a generated token exactly once. */
export function bootstrapAuth(): void {
  ensureDataDir();
  getSecret();
  const existing = readAuth();
  if (envToken()) {
    if (!existing) writeAuth({ salt: "", hash: "", epoch: 1 }); // keeps epoch state only
    return;
  }
  if (existing && existing.hash) return;
  const token = crypto.randomBytes(32).toString("base64url");
  const salt = crypto.randomBytes(16);
  writeAuth({ salt: salt.toString("base64url"), hash: scrypt(token, salt).toString("base64url"), epoch: existing?.epoch ?? 1 });
  const bar = "=".repeat(72);
  console.log(`\n${bar}\n  CAROUSEL STUDIO ACCESS TOKEN (shown ONCE, store it now):\n\n  ${token}\n\n  Only its hash is stored. Lost it? Delete data/auth.json and restart.\n${bar}\n`);
}

export function verifyToken(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 512) return false;
  const env = envToken();
  if (env) {
    // compare fixed-length digests so length differences don't leak
    const a = crypto.createHash("sha256").update(candidate).digest();
    const b = crypto.createHash("sha256").update(env).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const a = readAuth();
  if (!a || !a.hash) return false;
  const got = scrypt(candidate, Buffer.from(a.salt, "base64url"));
  const want = Buffer.from(a.hash, "base64url");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function getEpoch(): number {
  return readAuth()?.epoch ?? 1;
}

export function bumpEpoch(): number {
  const a = readAuth() ?? { salt: "", hash: "", epoch: 1 };
  a.epoch += 1;
  writeAuth(a);
  return a.epoch;
}

/** Returns the new plain token (show once). Not possible when the token comes from the environment. */
export function rotateToken(): string {
  if (envToken()) throw new Error("ENV_TOKEN");
  const a = readAuth() ?? { salt: "", hash: "", epoch: 1 };
  const token = crypto.randomBytes(32).toString("base64url");
  const salt = crypto.randomBytes(16);
  writeAuth({ salt: salt.toString("base64url"), hash: scrypt(token, salt).toString("base64url"), epoch: a.epoch + 1 });
  return token;
}
