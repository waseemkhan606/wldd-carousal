import { chromium } from "playwright";
(async () => { const [url, out, w = "1500", h = "1000"] = process.argv.slice(2);
  const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
  await p.goto("http://localhost:3000/login"); await p.fill("#token", "show-me-123"); await p.click("button:has-text('Enter')"); await p.waitForURL("**/brands");
  await p.goto("http://localhost:3000" + url); await p.waitForTimeout(4500); await p.screenshot({ path: out, fullPage: false }); await b.close(); })();
