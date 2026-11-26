// Settings, encrypted at rest (AES-256-GCM) with the machine-local secret in data/.secret.
import crypto from "node:crypto";
import { db } from "./index";
import { getSecret } from "../auth/store";

function key(): Buffer {
  return crypto.createHash("sha256").update("settings-v1").update(getSecret()).digest();
}
function enc(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}
function dec(s: string): string {
  const [iv, tag, ct] = s.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function getSetting(k: string): string | null {
  const r = db().prepare("SELECT value_encrypted v FROM settings WHERE key=?").get(k) as { v: string } | undefined;
  if (!r) return null;
  try { return dec(r.v); } catch { return null; }
}
export function setSetting(k: string, v: string | null): void {
  if (v === null || v === "") db().prepare("DELETE FROM settings WHERE key=?").run(k);
  else db().prepare("INSERT INTO settings(key,value_encrypted) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_encrypted=excluded.value_encrypted").run(k, enc(v));
}
export function getJson<T>(k: string, fallback: T): T {
  const v = getSetting(k);
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}
export const setJson = (k: string, v: unknown) => setSetting(k, JSON.stringify(v));

export const mask = (k: string | null) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : null);
