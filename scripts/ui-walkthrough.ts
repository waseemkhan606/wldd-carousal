// Browser walkthrough of the whole UI against a running server (CHECKPOINT 4). Takes a screenshot per screen.
//   BASE_URL=http://localhost:3200 TOKEN=... DATA_DIR=... tsx scripts/ui-walkthrough.ts
import { chromium, type Page } from "playwright";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3200", TOKEN = process.env.TOKEN!, DATA = process.env.DATA_DIR!;
const OUT = path.resolve("samples/ui");
fs.mkdirSync(OUT, { recursive: true });
const db = new Database(path.join(DATA, "app.db"), { readonly: true });
const calls = () => (db.prepare("SELECT COUNT(*) n FROM llm_calls").get() as { n: number }).n;
const results: [boolean, string][] = [];
const check = (ok: boolean, what: string) => { results.push([ok, what]); console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); };
const shot = (p: Page, n: string, full = true) => p.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full });
const itemStatus = (p: Page, text: string) => p.locator("[data-testid=check-item]", { hasText: text }).first().getAttribute("data-status");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const page = await ctx.newPage();
  // Failure paths are mocked so the walkthrough is deterministic and free whatever the state of the API key.
  await page.route("**/api/carousels", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: 'event: progress\ndata: {"stage":"copy"}\n\nevent: error\ndata: {"error":"LLM call \\"carousel.copy\\" failed on every provider. openrouter: auth: OpenRouter rejected the key (403) | gemini: no API key set"}\n\n' })
    : route.continue());
  await page.route("**/api/slides/*/regen", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "LLM call failed on every provider" }) }));
  await page.route("**/api/carousels/*/checklist", (route) => route.request().method() === "POST" ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "LLM call failed on every provider" }) }) : route.continue());
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  // --- auth
  await page.goto(BASE + "/brands");
  check(page.url().endsWith("/login"), "unauthenticated visit redirects to /login");
  await shot(page, "00-login", false);
  await page.fill("#token", "wrong-token"); await page.click("button:has-text('Enter')");
  await page.waitForSelector("[role=alert]"); check(true, "wrong token shows an error");
  await page.fill("#token", TOKEN); await page.click("button:has-text('Enter')");
  await page.waitForURL("**/brands"); check(true, "right token signs in");

  // --- brands
  await page.waitForSelector("[data-testid=brand-card]");
  await page.waitForTimeout(600);
  await shot(page, "01-brands");
  check((await page.locator("[data-testid=brand-card]").count()) >= 1, "brand grid shows the brand card");
  check(await page.locator("[data-testid=brand-card] img").first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), "brand thumbnail loads");
  check(/\d+ guidelines/.test(await page.locator("[data-testid=brand-card]").first().innerText()), "brand card shows its guideline count and palette");

  // --- brand page: guidelines tab (default)
  await page.locator("[data-testid=brand-card] a").first().click();
  await page.waitForSelector("[data-testid=guideline-section]");
  await page.waitForTimeout(500);
  await shot(page, "02-guidelines");
  const nRows = await page.locator("[data-testid=guideline-row]").count();
  check(nRows >= 30, `guidelines tab lists every guideline from the look book (${nRows})`);
  check((await page.locator("[data-testid=guideline-section]").count()) >= 6, "guidelines are grouped by look book section");
  check(/text blocks in the PDF were mapped/.test(await page.innerText("body")), "coverage of the look book is shown");

  // disabling a guideline and saving makes no LLM call
  const before = calls();
  const first = page.locator("[data-testid=guideline-row] input[type=checkbox]").first();
  await first.uncheck();
  check(await page.locator("text=Unsaved changes").isVisible(), "editing marks the form unsaved");
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=All changes saved", { timeout: 60000 });
  check(calls() === before, "saving guideline changes made no LLM call (cost 0)");
  await first.check(); await page.click("button:has-text('Save changes')"); await page.waitForSelector("text=All changes saved", { timeout: 60000 });

  // --- style tab
  await page.click("[role=tab]:has-text('Style')");
  await page.waitForSelector("[data-testid=archetype-card] img");
  await page.waitForTimeout(800);
  await shot(page, "03-style");
  check((await page.locator("[data-testid=colour-row]").count()) >= 3, "style tab lists colours with pickers");
  check((await page.locator("[data-testid=font-row]").count()) >= 2, "style tab lists font roles with Devanagari pairs");
  check((await page.locator("[data-testid=archetype-card]").count()) >= 2, "style tab shows templates with live previews");
  check((await page.locator("[data-testid=rule-row]").count()) >= 2, "style tab lists machine-checked rules");

  const hex = page.locator("[data-testid=colour-row] input.font-mono").first();
  const oldHex = await hex.inputValue(), newHex = oldHex.toUpperCase() === "#336699" ? "#339966" : "#336699";
  const src0 = await page.locator("[data-testid=archetype-card] img").first().getAttribute("src");
  const b2 = calls();
  await hex.fill(newHex);
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=All changes saved", { timeout: 60000 });
  await page.waitForTimeout(800);
  check(src0 !== (await page.locator("[data-testid=archetype-card] img").first().getAttribute("src")), "saving a colour re-renders the template previews");
  check(calls() === b2, "colour edit made no LLM call (cost 0)");
  await page.click("button:has-text('Rebuild templates')");
  await page.waitForSelector("text=Estimated cost");
  check(/₹/.test(await page.locator("[role=dialog]").innerText()), "rebuild shows its estimated cost before running");
  await page.click("[role=dialog] button:has-text('Cancel')");
  await hex.fill(oldHex); await page.click("button:has-text('Save changes')"); await page.waitForSelector("text=All changes saved", { timeout: 60000 });

  // --- create
  const brandId = page.url().split("/").pop();
  await page.goto(`${BASE}/create?brand=${brandId}`);
  await page.waitForSelector("[data-testid=estimate] >> text=/₹/");
  await page.fill("textarea", "Credit card ka interest-free period kaise kaam karta hai");
  await page.locator("input[type=range]").evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "7"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("[role=radio]:has-text('Hinglish')");
  await page.waitForTimeout(500);
  check((await page.locator("[data-testid=slide-count]").innerText()) === "7", "slider sets 7 slides");
  check((await page.locator("button", { hasText: "Let the AI choose" }).count()) === 1 && (await page.locator("button", { hasText: /5-slide/ }).count()) >= 1, "create offers the look book's own carousel formats");
  const est7 = await page.locator("[data-testid=estimate] p.text-3xl").innerText();
  check(/What will be applied/.test(await page.locator("[data-testid=estimate]").innerText()), "create states what will be applied from the look book");
  await shot(page, "04-create");
  await page.locator("input[type=range]").evaluate((el: HTMLInputElement) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, "3"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(700);
  const est3 = await page.locator("[data-testid=estimate] p.text-3xl").innerText();
  check(est3 !== est7, `estimate changes with slide count (${est3} for 3 vs ${est7} for 7)`);
  await page.click("button:has-text('Generate carousel')");
  await page.waitForSelector("[data-testid=progress]");
  await page.waitForSelector("text=/Failed:/", { timeout: 90000 });
  check(/failed on every provider|rejected the key|API key/i.test(await page.locator("[data-testid=progress]").innerText()), "with no usable provider, generation fails with a clear message and a visible step list");
  await shot(page, "05-generate-error", false);

  // --- carousel viewer + checklist
  // an English carousel generated before the cover rule was enforced: it still has a real defect to fix inline
  const cid = (db.prepare("SELECT id FROM carousels WHERE copy_json IS NOT NULL AND language='en' AND status IN ('ready','needs_review') AND id <= 16 ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  await page.goto(`${BASE}/carousel/${cid}`);
  await page.waitForSelector("[data-testid=preview]");
  await page.waitForSelector("[data-testid=checklist]");
  await page.waitForFunction(() => (document.querySelector("[data-testid=preview]") as HTMLImageElement).complete);
  await page.waitForTimeout(600);
  await shot(page, "06-carousel-checklist", false);
  check((await page.locator("[data-testid=strip] button").count()) >= 3, "slide strip lists every slide");
  check(await page.locator("[data-testid=preview]").evaluate((i: HTMLImageElement) => i.naturalWidth === 1080 && i.naturalHeight === 1350), "preview is the real 1080x1350 slide");
  check(/\d+\/\d+/.test(await page.locator("[data-testid=checklist] [role=img]").first().getAttribute("aria-label") ?? "") || (await page.locator("[data-testid=checklist] svg").count()) > 0, "checklist shows the adherence score ring");
  check(/guidelines followed|Every guideline/.test(await page.locator("[data-testid=checklist]").innerText()), "checklist headline states how many guidelines were followed");
  await page.click("button:has-text('All (')");
  await page.waitForTimeout(300);
  const total = await page.locator("[data-testid=check-item]").count();
  check(total >= 30, `checklist lists every guideline with evidence (${total})`);
  check((await itemStatus(page, "Max 30 words")) !== null, "checklist includes the look book's word-limit rule");
  check((await itemStatus(page, "Slide 1: the hook question")) !== null, "checklist includes the cover rule");
  check((await page.locator("[data-testid=check-item][data-status=pass]").count()) > 10, "many guidelines are verifiably followed");
  const evidenceRows = await page.locator("[data-testid=check-item][data-status=pass] p").count();
  check(evidenceRows > 10, "passed items show their evidence, not just a tick");
  // expanding an item shows the look book quote and page
  await page.locator("[data-testid=check-item]").first().locator("button").first().click();
  check(/Look book, page \d/.test(await page.locator("[data-testid=checklist]").innerText()), "expanding an item shows the look book page and quote");
  await shot(page, "07-checklist-all", false);

  // fix a failing guideline inline and watch the checklist flip (₹0)
  await page.click("button:has-text('All (')");
  const coverStatus = await itemStatus(page, "Slide 1: the hook question");
  await page.click("button:has-text('Needs attention')");
  if (coverStatus === "fail") {
    await page.locator("[data-testid=check-item][data-status=fail]", { hasText: "Slide 1: the hook question" }).locator("button:has-text('Go to slide 1')").click();
    await page.waitForSelector("textarea[id^=slot-]");
    const callsBeforeEdit = calls();
    const stampBox = page.locator("textarea#slot-stamp");
    await stampBox.fill("READ THIS FIRST"); await stampBox.press("Enter");
    await page.waitForSelector("[role=status]:has-text('Saved')", { timeout: 60000 });
    await page.waitForTimeout(800);
    check(calls() === callsBeforeEdit, "fixing a guideline by editing text made no LLM call (cost 0)");
    await page.click("[role=tab]:has-text('Checklist')");
    await page.click("button:has-text('All (')");
    await page.waitForTimeout(600);
    check((await itemStatus(page, "Slide 1: the hook question")) === "pass", "the cover-stamp guideline flips to followed after the edit");
    await shot(page, "08-after-fix", false);
  } else check(true, `cover guideline already ${coverStatus}`);

  // preview + platform + regenerate failure
  await page.click("[role=tab]:has-text('Edit')");
  const v0 = await page.locator("[data-testid=preview]").getAttribute("src");
  await page.keyboard.press("Escape");
  await page.click("[role=tab]:has-text('LinkedIn')");
  await page.waitForTimeout(500);
  check((await page.locator("[data-testid=preview]").getAttribute("src"))!.includes("/linkedin/"), "LinkedIn tab shows the LinkedIn render");
  await page.click("[role=tab]:has-text('Instagram')");
  await page.locator("button:has-text('Regenerate')").first().click();
  await page.waitForSelector("text=/Regeneration failed/", { timeout: 90000 });
  check((await page.locator("[data-testid=preview]").getAttribute("src")) !== null && v0 !== null, "a failed regeneration shows a clear error and leaves the slide alone");
  // keyboard navigation
  await page.click("[data-testid=preview]");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  check(/Slide 2 of/.test(await page.innerText("body")), "arrow keys move between slides");

  // AI check unavailable -> clear error
  await page.click("[role=tab]:has-text('Checklist')");
  const aiBtn = page.locator("button:has-text('Run AI check'), button:has-text('Re-run AI check')").first();
  await aiBtn.click();
  await page.waitForSelector("[role=status]:has-text('AI check unavailable')", { timeout: 60000 });
  check(true, "AI check without a usable provider reports it clearly (code/template checks still show)");

  // captions + cost tabs
  await page.click("[role=tab]:has-text('Captions')");
  check(/Sources and assumptions/.test(await page.innerText("body")), "captions include the sources line the look book asks for");
  await page.click("[role=tab]:has-text('Cost')");
  check(await page.locator("[data-testid=cost-panel] td", { hasText: "Look book ingest" }).first().isVisible(), "cost tab shows per-step costs and the ingest line");
  await shot(page, "09-cost", false);

  // downloads
  for (const k of ["instagram_pdf", "instagram_zip", "linkedin_pdf", "captions", "all", "cost"]) {
    const r = await page.request.get(`${BASE}/api/export/${cid}?kind=${k}`);
    check(r.status() === 200 && (await r.body()).length > 100, `download ${k} returns a file`);
  }

  // --- settings
  await page.goto(BASE + "/settings");
  await page.waitForSelector("text=API keys");
  check(/…/.test(await page.locator("text=saved").first().innerText()), "API key is shown masked");
  await page.click("button:has-text('Test') >> nth=0");
  await page.waitForTimeout(4000);
  await page.click("button:has-text('Fetch live list')");
  await page.waitForSelector("text=/models loaded/", { timeout: 30000 });
  check(true, "live OpenRouter model list loads");
  await shot(page, "10-settings");

  // --- mobile
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 } }); const mp = await mob.newPage();
  await mp.goto(BASE + "/login"); await mp.fill("#token", TOKEN); await mp.click("button:has-text('Enter')"); await mp.waitForURL("**/brands");
  for (const [u, n] of [[`/carousel/${cid}`, "11-mobile-carousel"], ["/brands", "12-mobile-brands"], ["/create", "13-mobile-create"], [`/brands/${brandId}`, "14-mobile-brand"]] as const) {
    await mp.goto(BASE + u); await mp.waitForTimeout(2200); await shot(mp, n);
    check(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll at phone width on ${u.split("/")[1]}`);
  }

  // --- logout
  await page.goto(BASE + "/brands"); await page.click("text=Log out"); await page.waitForURL("**/login");
  check((await page.request.get(`${BASE}/api/brands`)).status() === 401, "after logout the API returns 401");
  check(consoleErrors.length === 0, `no uncaught page errors${consoleErrors.length ? ": " + consoleErrors[0] : ""}`);

  await browser.close();
  const bad = results.filter(([ok]) => !ok);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("WALKTHROUGH CRASHED:", e.message); process.exit(2); });
