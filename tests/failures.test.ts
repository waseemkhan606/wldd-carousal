import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { analyseLookbook } from "@/lib/ingest/anatomy";

const tmp = (n: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-f-")), n);

describe("failure handling at upload", () => {
  it("a scanned/blank PDF (no text) yields no structure and a warning, not a crash", async () => {
    const f = tmp("blank.pdf"); const d = await PDFDocument.create(); d.addPage([810, 1000]); fs.writeFileSync(f, await d.save());
    const a = await analyseLookbook(f);
    expect(a.warnings.length + (a.colours.length ? 0 : 1)).toBeGreaterThan(0);
  });
  it("a file that is not a PDF is rejected with an error", async () => {
    const f = tmp("fake.pdf"); fs.writeFileSync(f, "this is not a pdf");
    await expect(analyseLookbook(f)).rejects.toThrow();
  });
});

describe("credit preflight", () => {
  it("refuses before spending when no key is set", async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cs-pf-"));
    const { assertCredits, CreditError } = await import("@/lib/llm/preflight");
    await expect(assertCredits(1, "a test")).rejects.toBeInstanceOf(CreditError);
  });
});

describe("progress stream survives a disconnected browser", () => {
  it("lets the job finish when the client goes away", async () => {
    const { sse } = await import("@/lib/api");
    let finished = false;
    const res = sse(async (send) => { await new Promise((r) => setTimeout(r, 30)); send("progress", { a: 1 }); await new Promise((r) => setTimeout(r, 30)); send("progress", { a: 2 }); finished = true; return { ok: true }; });
    const reader = res.body!.getReader(); await reader.cancel(); // browser closes the tab
    await new Promise((r) => setTimeout(r, 200));
    expect(finished).toBe(true);
  });
});
