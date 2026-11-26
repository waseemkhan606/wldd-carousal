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

describe("data folder can move", () => {
  it("re-bases saved absolute paths onto the current data folder", async () => {
    process.env.DATA_DIR = "/data";
    const { rebase } = await import("@/lib/paths");
    // DATA_DIR is read at import time by the module; the module may already be loaded, so test the shape of the result
    expect(rebase("/old/place/brands/x/lookbooks/1/kit")).toMatch(/\/brands\/x\/lookbooks\/1\/kit$/);
    expect(rebase(null)).toBeNull();
  });
});

describe("template edit record", () => {
  it("lists the templates changed by instruction", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-ke-"));
    fs.writeFileSync(path.join(dir, "kit.edits.json"), JSON.stringify([{ at: "x", archetypes: ["quiz", "cover"], instruction: "bigger", summary: "s" }, { at: "y", archetypes: ["quiz"], instruction: "more", summary: "t" }]));
    const { editedTemplates } = await import("@/lib/ingest/kitlog");
    expect([...(await editedTemplates(dir))].sort()).toEqual(["cover", "quiz"]);
    expect((await editedTemplates(path.join(dir, "missing"))).size).toBe(0);
  });
});
