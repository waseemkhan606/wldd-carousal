import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cs-auth-"));
process.env.APP_ACCESS_TOKEN = "unit-test-token-123";

describe("auth", () => {
  let store: typeof import("@/lib/auth/store"), session: typeof import("@/lib/auth/session"), rl: typeof import("@/lib/auth/ratelimit");
  beforeAll(async () => { store = await import("@/lib/auth/store"); session = await import("@/lib/auth/session"); rl = await import("@/lib/auth/ratelimit"); store.bootstrapAuth(); });

  it("accepts only the right token", () => { expect(store.verifyToken("unit-test-token-123")).toBe(true); expect(store.verifyToken("nope")).toBe(false); expect(store.verifyToken("")).toBe(false); });
  it("validates its own session cookie and rejects garbage", () => { expect(session.validSession(session.makeSession())).toBe(true); expect(session.validSession("garbage")).toBe(false); expect(session.validSession(undefined)).toBe(false); });
  it("tampering with a session invalidates it", () => { const c = session.makeSession(); expect(session.validSession(c.slice(0, -2) + (c.endsWith("aa") ? "bb" : "aa"))).toBe(false); });
  it("locks an address out after 5 failures", () => { const ip = "10.9.9.9"; for (let i = 0; i < 4; i++) { rl.recordFailure(ip); expect(rl.checkLimit(ip).ok).toBe(true); } rl.recordFailure(ip); expect(rl.checkLimit(ip).ok).toBe(false); });
  it("bumping the epoch signs old sessions out", () => { const c = session.makeSession(); store.bumpEpoch(); expect(session.validSession(c)).toBe(false); expect(session.validSession(session.makeSession())).toBe(true); });
  it("refuses to rotate a token that comes from the environment", () => { expect(() => store.rotateToken()).toThrow("ENV_TOKEN"); });
  it("stores only a hash, never the token", () => { const raw = fs.readFileSync(path.join(process.env.DATA_DIR!, "auth.json"), "utf8"); expect(raw).not.toContain("unit-test-token-123"); });
});
