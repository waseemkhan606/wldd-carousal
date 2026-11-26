// Two synthetic look books that share the SAME document anatomy as a real one (profile, brand system with colours /
// elements / type / pillars, one page per post format, carousel cover, "inside the carousel" with rule bullets and
// voice, logo page) but have completely different style and content. They exist to prove the pipeline is brand-agnostic.
// Nothing in /lib may reference them.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("fixtures");

type Theme = {
  file: string; fonts: string; brand: string; handle: string; tagline: [string, string]; highlights: string[]; feed: string;
  pal?: [string, string, string, string]; alt?: { bg: string; fg: string }; // slide colours when they differ from the swatch order: [text, accent, stamp, light bg]; alt = the second background
  colours: { name: string; hex: string; usage: string }[]; // [dark bg, accent, stamp, light bg]
  elements: [string, string, string, string]; // texture, stamp, edge, logo captions
  type: [string, string, string]; pillars: { name: string; desc: string; label: string }[]; cadence: string;
  fontDisplay: string; fontBody: string; fontMono: string; r: number; // r = corner radius
  post1: { tag: string; big: string; sub: string; body: string; math: string; stamp: string };
  post2: { tag: string; q: string; opts: string[]; foot: string };
  cover: { tag: string; head: string[]; stamp: string; body: string };
  inside: { n: string; big: string; text: string; stamp?: string; dark?: boolean }[];
  rules: string[]; voice: string; logoRule: string; deco: "ruled" | "grid" | "glow"; stampStyle: "rubber" | "sticker" | "seal"; edge: "receipt" | "tape" | "scallop";
};

const themes: Theme[] = [
  {
    file: "Brutal Dev - sample look book", fonts: "family=Archivo+Black&family=IBM+Plex+Mono:wght@400;600&family=Space+Mono:wght@400;700",
    brand: "Ship It", handle: "shipit.log", tagline: ["Dev tips with zero fluff.", "One command, one lesson."], highlights: ["Commands", "Quiz", "Teardowns", "Gotchas", "Tools"],
    feed: "FEED: COMMANDS ON WHITE · QUIZZES ON BLACK · TEARDOWNS AS CAROUSELS",
    colours: [{ name: "INK BLACK", hex: "#0A0A0A", usage: "QUIZ BG, HEADLINES, LOGO" }, { name: "VOLT YELLOW", hex: "#FFE600", usage: "BIG NUMBERS ON BLACK, TAGS" }, { name: "ALERT RED", hex: "#FF2D2D", usage: "STAMPS, WARNINGS, RULE LINE" }, { name: "PAPER WHITE", hex: "#FAFAFA", usage: "COMMAND + TEARDOWN POSTS" }],
    elements: ["GRID PAPER + RED RULE", "STICKER STAMP, TILTED 3°", "TORN TAPE EDGE, TOP/BOTTOM", "LOGO, BOTTOM-RIGHT"],
    type: ["ARCHIVO BLACK · HEADLINES, NUMBERS", "IBM PLEX MONO 400/600 · BODY", "SPACE MONO · TAGS, COMMANDS"], cadence: "PILLARS · 2 POSTS A DAY",
    pillars: [{ name: "The Command", desc: "One command + what it does", label: "WHITE POST" }, { name: "Quick Fix", desc: "Four options, answer next day", label: "BLACK POST" }, { name: "The Teardown", desc: "5-slide explainer", label: "CAROUSEL" }, { name: "The Gotcha", desc: "A common dev mistake, stamped", label: "CAROUSEL" }],
    fontDisplay: "'Archivo Black'", fontBody: "'IBM Plex Mono'", fontMono: "'Space Mono'", r: 0, deco: "grid", stampStyle: "sticker", edge: "tape",
    post1: { tag: "THE COMMAND · GIT", big: "--force-with-lease", sub: "Safer than --force.", body: "It refuses to overwrite work you have not seen. Same result, nobody's commits deleted.", math: "git push --force-with-lease", stamp: "SAVE THIS" },
    post2: { tag: "QUICK FIX", q: "Which undoes the last commit but keeps your files?", opts: ["git reset --hard", "git reset --soft HEAD~1", "git revert HEAD", "git checkout ."], foot: "ANSWER IN THE COMMENTS · REVEAL TOMORROW" },
    cover: { tag: "THE TEARDOWN · GIT", head: ["Why your", "rebase", "keeps failing?"], stamp: "READ THIS FIRST", body: "It rewrites history. It does not fix history." },
    inside: [{ n: "02 / 05", big: "3 steps", text: "Fetch, rebase, then force with lease. In that order." }, { n: "03 / 05", big: "1 rule", text: "Never rebase a branch someone else has pulled.", dark: true }, { n: "04 / 05", big: "40%", text: "of merge conflicts come from long-lived branches.", stamp: "GOTCHA" }],
    rules: ["Slide 1: the hook question + a stamp · 2–4: one command or idea each", "Slides alternate white and black · yellow numbers only on black", "Slide 5: the fix + \"Save this\" stamp · sources in the caption", "Tag top-left, slide count top-right, logo bottom-right on every slide", "Max 24 words a slide · one stamp per slide, max · no stock photos, no faces"],
    voice: "Blunt, dry, a little smug. Talk like a senior engineer who has seen the outage. Plain English in captions. Always show the command.", logoRule: "LOGO · BRACKETS + CURSOR · USE ON YELLOW BLOCK ONLY",
  },
  {
    file: "Maison Lune - sample look book", fonts: "family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=Jost:wght@300;400;500",
    brand: "Maison Lune", handle: "maisonlune.skin", tagline: ["Slow skincare, softly.", "One ritual a day, with the why."], highlights: ["Rituals", "Quiz", "Routines", "Myths", "Shop"],
    feed: "FEED: RITUALS ON ROSE · QUIZZES ON CREAM · ROUTINES AS CAROUSELS",
    colours: [{ name: "ROSE MILK", hex: "#F6DDE0", usage: "RITUAL + ROUTINE POSTS" }, { name: "OAT CREAM", hex: "#FBF6EE", usage: "QUIZ BG, QUIET PAGES" }, { name: "PLUM INK", hex: "#5B3A4A", usage: "HEADLINES, BODY, CLOSERS" }, { name: "BRUSHED GOLD", hex: "#C9A98B", usage: "HAIRLINES, SEALS, LOGO" }],
    elements: ["PEARL MOON GLOW + GOLD HAIRLINE", "WAX SEAL STAMP, TILTED 6°", "SCALLOPED EDGE, TOP/BOTTOM", "LOGO, BOTTOM-RIGHT"],
    type: ["CORMORANT GARAMOND 400/600 · HEADLINES, NUMBERS", "JOST 300/400 · BODY", "JOST 500 · TAGS, LABELS"], cadence: "PILLARS · 1 POST A DAY",
    pillars: [{ name: "The Ritual", desc: "One step + why it works", label: "ROSE POST" }, { name: "Skin Quiz", desc: "Four options, answer next day", label: "CREAM POST" }, { name: "The Routine", desc: "5-slide guide", label: "CAROUSEL" }, { name: "The Myth", desc: "A common skincare myth, sealed", label: "CAROUSEL" }],
    pal: ["#5B3A4A", "#C9A98B", "#C9A98B", "#F6DDE0"], alt: { bg: "#FBF6EE", fg: "#5B3A4A" }, fontDisplay: "'Cormorant Garamond'", fontBody: "'Jost'", fontMono: "'Jost'", r: 28, deco: "glow", stampStyle: "seal", edge: "scallop",
    post1: { tag: "THE RITUAL · CLEANSE", big: "60 seconds", sub: "Lukewarm water, fingertips only.", body: "Rushing is what dulls skin, not the product. Slow circles let the cleanser do its work.", math: "60 sec × 2 = 2 minutes a day", stamp: "SAVE THIS" },
    post2: { tag: "SKIN QUIZ", q: "Which layer goes on first?", opts: ["Cream", "Serum", "Toner", "Oil"], foot: "ANSWER IN THE COMMENTS · REVEAL TOMORROW" },
    cover: { tag: "THE ROUTINE · EVENING", head: ["Layering", "in the", "right order?"], stamp: "READ THIS FIRST", body: "Thin to thick. Water-based first, oils last." },
    inside: [{ n: "02 / 05", big: "Toner", text: "Water-based first. It prepares skin for what follows." }, { n: "03 / 05", big: "Serum", text: "A few drops. Press, don't rub.", dark: true }, { n: "04 / 05", big: "Oil", text: "Last, to seal everything in.", stamp: "MYTH" }],
    rules: ["Slide 1: the hook question + a seal · 2–4: one step or idea each", "Slides alternate rose and cream · gold only as hairlines and seals", "Slide 5: the takeaway + \"Save this\" seal · sources in the caption", "Tag top-left, slide count top-right, logo bottom-right on every slide", "Max 28 words a slide · one seal per slide, max · no stock photos, no faces"],
    voice: "Calm, warm, unhurried, like a friend in a good dressing gown. Hinglish is welcome in captions. Always say why it works.", logoRule: "LOGO · CRESCENT MOON · USE ON GOLD CIRCLE ONLY",
  },
];

const css = (t: Theme) => {
  const [dark, accent, stamp, light] = t.pal ?? t.colours.map((c) => c.hex);
  return `
  *{box-sizing:border-box;margin:0}
  body{font-family:${t.fontBody},sans-serif;color:${dark}}
  .page{width:1080px;height:1440px;position:relative;overflow:hidden;background:${t.alt?.bg ?? light};color:${dark};page-break-after:always;padding:54px 72px}
  .page.dk{background:#0b0b0b;color:#eee}
  .strip{position:absolute;left:0;right:0;font:700 17px ${t.fontMono};color:#8a8a8a;letter-spacing:2px;padding:12px 72px}
  h1.pt{font:400 52px ${t.fontDisplay};margin:0 0 6px;color:${dark}}
  .lab{font:700 17px ${t.fontMono};letter-spacing:3px;color:#8a8a8a;text-transform:uppercase}
  .mono{font-family:${t.fontMono}} .disp{font-family:${t.fontDisplay}}
  .sw{width:230px;display:inline-block;vertical-align:top;margin-right:28px}
  .chip{height:96px;border-radius:${Math.min(t.r, 18)}px;border:1px solid #555;margin-bottom:14px}
  .cap{font:700 15px ${t.fontMono};letter-spacing:1.5px;color:#555;line-height:1.5;text-transform:uppercase}
  .row{display:flex;gap:26px;align-items:flex-end;margin-top:20px}
  .elbox{width:230px;height:150px;border:1px solid #555;position:relative;overflow:hidden;background:${light}}
  .slide{position:absolute;left:0;width:1080px;height:1350px;overflow:hidden;padding:90px 150px 90px 150px}
  .grid{background-image:linear-gradient(${dark}18 1px,transparent 1px),linear-gradient(90deg,${dark}18 1px,transparent 1px);background-size:54px 54px}
  .ruled::before{content:'';position:absolute;inset:0;background-image:repeating-linear-gradient(to bottom,transparent 0 53px,${dark}14 53px 54px),linear-gradient(to right,transparent 119px,${stamp}66 119px 122px,transparent 122px)}
  .glow::before{content:'';position:absolute;right:-90px;top:-90px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ffffffcc,${accent}22 70%)}
  .tag{font:700 24px ${t.fontMono};letter-spacing:4px;text-transform:uppercase;position:absolute;left:150px;top:90px;color:${dark}99}
  .cnt{font:400 24px ${t.fontMono};position:absolute;right:90px;top:90px;color:${dark}99}
  .big{font:400 190px/1 ${t.fontDisplay};margin-top:140px}
  .h{font:400 128px/1 ${t.fontDisplay};margin-top:200px}
  .sub{font:400 64px/1.15 ${t.fontDisplay};margin-top:30px}
  .txt{font:400 38px/1.5 ${t.fontBody};margin-top:50px;max-width:800px}
  .mth{font:400 30px ${t.fontMono};margin-top:50px}
  .stp{display:inline-block;font:700 36px ${t.fontMono};letter-spacing:4px;text-transform:uppercase;padding:12px 24px;margin-top:40px;color:${stamp};transform:rotate(${t.stampStyle === "seal" ? 6 : t.stampStyle === "sticker" ? 3 : -4}deg);
    border:${t.stampStyle === "sticker" ? "0" : "4px"} solid ${stamp};${t.stampStyle === "sticker" ? `background:${stamp};color:${light};` : ""}${t.stampStyle === "seal" ? "border-radius:60px;" : ""}}
  .hdl{position:absolute;left:150px;bottom:90px;font:400 24px ${t.fontMono};letter-spacing:3px;text-transform:uppercase;color:${dark}99}
  .logo{position:absolute;right:90px;bottom:90px;width:80px;height:80px;border-radius:${t.r ? "50%" : "0"};background:${accent};display:flex;align-items:center;justify-content:center;font:700 38px ${t.fontMono};color:${dark}}
  .edge{position:absolute;left:0;right:0;height:26px;background:${t.edge === "tape" ? `repeating-linear-gradient(135deg,${dark}22 0 14px,transparent 14px 28px)` : t.edge === "scallop" ? `radial-gradient(circle at 13px 0,${dark}22 12px,transparent 13px) 0 0/26px 26px` : `repeating-linear-gradient(135deg,${dark}33 0 10px,transparent 10px 20px)`}}
  .opt{display:inline-block;width:390px;min-height:190px;margin:0 20px 20px 0;padding:24px;background:${light};color:${dark};border-radius:${t.r}px;font:400 40px/1.15 ${t.fontDisplay};vertical-align:top}
  .opt small{display:block;font:700 22px ${t.fontMono};opacity:.6;margin-bottom:14px}
  ul.rl{list-style:none;padding:0;font:400 25px/1.4 ${t.fontBody};color:${dark}} ul.rl li{padding:11px 0}
  .p{font:400 27px/1.5 ${t.fontBody};color:#555;max-width:850px}
  .frame{position:absolute;overflow:hidden;width:297px;height:371px}
  .frame>.slide{zoom:.275}
  `;
};

function slideInner(t: Theme, kind: "number" | "quiz" | "cover" | { n: string; big: string; text: string; stamp?: string; dark?: boolean }, i = 1): { bg: string; html: string } {
  const [dark, accent, , light] = t.pal ?? t.colours.map((c) => c.hex);
  const altBg = t.alt?.bg ?? dark, altFg = t.alt?.fg ?? light;
  const deco = t.deco === "ruled" ? "ruled" : t.deco === "grid" ? "grid" : "glow";
  const edges = `<div class="edge" style="top:0"></div><div class="edge" style="bottom:0"></div>`;
  if (kind === "number") {
    const p = t.post1;
    return { bg: light, html: `<div class="slide ${deco}" style="background:${light};color:${dark}">${edges}<div class="tag">${p.tag}</div><div class="big" style="color:${dark};font-size:${p.big.length > 12 ? 118 : 190}px">${p.big}</div><div class="sub">${p.sub}</div><div class="txt">${p.body}</div><div class="mth">${p.math}</div><div><span class="stp">${p.stamp}</span></div><div class="hdl">${t.handle}</div><div class="logo">${t.brand[0]}</div></div>` };
  }
  if (kind === "quiz") {
    const q = t.post2;
    return { bg: altBg, html: `<div class="slide" style="background:${altBg};color:${altFg}"><div class="tag" style="color:${accent}">${q.tag}</div><div class="h" style="font-size:78px;margin-top:70px;color:${altFg}">${q.q}</div><div style="margin-top:40px">${q.opts.map((o, k) => `<div class="opt"><small>${"ABCD"[k]}</small>${o}</div>`).join("")}</div><div class="txt mono" style="font-size:24px;letter-spacing:3px;color:${accent}">${q.foot}</div><div class="logo">${t.brand[0]}</div></div>` };
  }
  if (kind === "cover") {
    const c = t.cover;
    return { bg: light, html: `<div class="slide ${deco}" style="background:${light};color:${dark}"><div class="tag">${c.tag}</div><div class="cnt">01 / 05</div><div class="h">${c.head.join("<br>")}</div><div><span class="stp">${c.stamp}</span></div><div class="txt" style="margin-top:30px">${c.body}</div><div class="txt" style="font-weight:600;margin-top:40px">Swipe →</div><div class="logo">${t.brand[0]}</div></div>` };
  }
  const s = kind, bg = s.dark ? altBg : light, fg = s.dark ? altFg : dark;
  return { bg, html: `<div class="slide ${s.dark ? "" : deco}" style="background:${bg};color:${fg}"><div class="tag" style="${s.dark ? `color:${accent}` : ""}">${t.cover.tag.split(" · ")[0]}</div><div class="cnt" style="${s.dark ? `color:${accent}` : ""}">${s.n}</div><div class="big" style="font-size:150px;color:${s.dark ? accent : fg}">${s.big}</div><div class="txt" style="color:${fg}">${s.text}</div>${s.stamp ? `<div><span class="stp">${s.stamp}</span></div>` : ""}<div class="hdl" style="${s.dark ? `color:${fg}99` : ""}">${t.handle}</div><div class="logo">${t.brand[0]}</div></div>` };
}

function pages(t: Theme): string[] {
  const [dark, accent, stamp, light] = t.pal ?? t.colours.map((c) => c.hex);
  const postPage = (label: string, s: { bg: string; html: string }) => `<div class="page" style="padding:0"><div class="strip" style="top:0">POST · ${label} · 1080 × 1350</div><div style="position:absolute;left:0;top:45px;width:1080px;height:1350px;background:${s.bg};overflow:hidden">${s.html.replace(/<div class="slide([^"]*)" style="/, '<div class="slide$1" style="top:0;')}</div></div>`;
  const frameAt = (x: number, s: ReturnType<typeof slideInner>) => `<div class="frame" style="left:${x}px;top:210px;background:${s.bg}">${s.html.replace(/<div class="slide([^"]*)" style="/, '<div class="slide$1" style="top:0;left:0;')}</div>`;
  return [
    // 1 profile
    `<div class="page dk"><div class="lab">Profile</div><div class="lab" style="margin-top:6px">HOW IT LOOKS ON INSTAGRAM · DARK MODE</div>
      <div class="mono" style="margin-top:50px;font-size:24px;color:#fff">${t.handle}</div>
      <div style="display:flex;gap:80px;margin-top:30px"><div><b style="font-size:34px">186</b><div class="cap">posts</div></div><div><b style="font-size:34px">31.4K</b><div class="cap">followers</div></div><div><b style="font-size:34px">2</b><div class="cap">following</div></div></div>
      <h1 class="pt" style="margin-top:36px">${t.brand}</h1><div class="p">${t.tagline[0]}<br>${t.tagline[1]}</div>
      <div class="row" style="margin-top:44px">${t.highlights.map((h) => `<div style="text-align:center;width:150px"><div style="width:96px;height:96px;border-radius:50%;background:${accent};margin:0 auto 10px"></div><div class="cap" style="text-transform:none;font:400 20px ${t.fontBody}">${h}</div></div>`).join("")}</div>
      <div class="row" style="margin-top:50px;align-items:flex-start">${[["number", 0], ["quiz", 0], ["cover", 0]].map(([k], i) => { const s = slideInner(t, k as any); return `<div class="frame" style="position:relative;width:297px;height:371px;background:${s.bg}">${s.html.replace(/<div class="slide([^"]*)" style="/, '<div class="slide$1" style="top:0;left:0;')}</div>`; }).join("")}</div>
      <div class="lab" style="position:absolute;bottom:60px;left:72px">${t.feed}</div></div>`,
    // 2 brand system
    `<div class="page"><h1 class="pt">${t.brand}</h1><div class="lab" style="margin-top:10px">BRAND SYSTEM · ${t.elements[0].split(" + ")[0]} + ${t.elements[1].split(",")[0].split(" ")[0]}</div>
      <div class="lab" style="margin-top:36px;color:#555">BRAND COLOURS</div>
      <div class="row" style="align-items:flex-start;margin-top:22px">${t.colours.map((c) => `<div class="sw"><div class="chip" style="background:${c.hex}"></div><div class="cap" style="color:${dark}">${c.name}</div><div class="cap">${c.hex} · ${c.usage}</div></div>`).join("")}</div>
      <div class="lab" style="margin-top:40px;color:#555">ELEMENTS</div>
      <div class="row" style="align-items:flex-start;margin-top:20px">
        <div><div class="elbox ${t.deco}" style="position:relative;${t.deco === "glow" ? "" : `background-color:${light}`}"></div><div class="cap" style="margin-top:12px;width:210px">${t.elements[0]}</div></div>
        <div><div class="elbox" style="display:flex;align-items:center;justify-content:center"><span class="stp" style="margin:0;font-size:30px">TRAP</span></div><div class="cap" style="margin-top:12px;width:210px">${t.elements[1]}</div></div>
        <div><div class="elbox"><div class="edge" style="top:0"></div></div><div class="cap" style="margin-top:12px;width:210px">${t.elements[2]}</div></div>
        <div><div class="elbox" style="display:flex;align-items:center;justify-content:center"><div class="logo" style="position:static">${t.brand[0]}</div></div><div class="cap" style="margin-top:12px;width:210px">${t.elements[3]}</div></div></div>
      <div class="lab" style="margin-top:40px;color:#555">TYPE</div>
      <div style="position:relative;height:200px;margin-top:20px">
        <div class="disp" style="position:absolute;left:0;top:0;font-size:46px;color:${dark}">${t.brand}, every day.</div><div class="cap" style="position:absolute;left:640px;top:14px;color:${dark}">${t.type[0]}</div>
        <div style="position:absolute;left:0;top:70px;font:400 30px ${t.fontBody};color:#555">Small steps, every day, add up fast.</div><div class="cap" style="position:absolute;left:640px;top:78px">${t.type[1]}</div>
        <div class="mono" style="position:absolute;left:0;top:130px;font-size:24px;letter-spacing:3px;color:#ccc">THE ${t.pillars[0].name.split(" ")[1].toUpperCase()} · 365 DAYS</div><div class="cap" style="position:absolute;left:640px;top:134px">${t.type[2]}</div></div>
      <div class="lab" style="margin-top:34px;color:#555">${t.cadence}</div>
      <div style="margin-top:20px">${t.pillars.map((p) => `<div style="display:flex;padding:13px 0;border-top:1px solid #444;font:400 26px ${t.fontBody}"><div style="width:240px;color:${dark};font-weight:600">${p.name}</div><div style="width:520px;color:#ccc">${p.desc}</div><div class="cap">${p.label}</div></div>`).join("")}</div></div>`,
    // 3,4 posts
    postPage("THE " + t.pillars[0].name.replace(/^The /i, "").toUpperCase(), slideInner(t, "number")),
    postPage(t.pillars[1].name.toUpperCase(), slideInner(t, "quiz")),
    // 5 cover
    (() => { const cv = slideInner(t, "cover"); return `<div class="page" style="padding:0"><div class="strip" style="top:0">CAROUSEL · SLIDE 1 (COVER) · 1080 × 1350</div><div style="position:absolute;left:0;top:45px;width:1080px;height:1350px;overflow:hidden;background:${cv.bg}">${cv.html.replace(/<div class="slide([^"]*)" style="/, '<div class="slide$1" style="top:0;')}</div></div>`; })(),
    // 6 inside
    `<div class="page"><h1 class="pt">Inside the ${t.pillars[2].name.replace(/^The /i, "").toLowerCase()}</h1><div class="lab" style="margin-top:8px">CAROUSEL · 5 SLIDES · ONE IDEA EACH</div>
      ${t.inside.map((s, i) => frameAt(72 + i * 330, slideInner(t, s))).join("")}
      <div style="position:absolute;left:72px;top:640px;width:940px"><ul class="rl">${t.rules.map((r) => `<li>▸ ${r}</li>`).join("")}</ul></div>
      <div class="lab" style="position:absolute;left:72px;top:1190px;color:#555">VOICE</div><div class="p" style="position:absolute;left:72px;top:1230px;width:900px">${t.voice}</div></div>`,
    // 7 logo
    `<div class="page"><div class="lab">@${t.handle}</div><div style="margin:200px auto 0;width:300px;height:300px;border-radius:${t.r ? "50%" : "0"};background:${accent};display:flex;align-items:center;justify-content:center;font:700 150px ${t.fontMono};color:${dark}">${t.brand[0]}</div>
      <div class="lab" style="margin-top:60px;text-align:center">${t.logoRule}</div><div class="lab" style="position:absolute;bottom:60px;left:72px;font-size:14px">SAMPLE LOOK BOOK · FICTIONAL PAGE MADE FOR TESTING</div></div>`,
  ];
}

// a look book that states an explicit slide order: "Slide 4 is on black"
themes.push({ ...themes[0], file: "Brutal Dev - order test - sample look book", rules: [...themes[0].rules.slice(0, 4), "Slide 4: the teardown on black · max 24 words a slide · one stamp per slide, max · no stock photos, no faces"] });

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const t of themes) {
    const html = `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?${t.fonts}&display=swap" rel="stylesheet"><style>${css(t)}@page{size:1080px 1440px;margin:0}</style><body>${pages(t).join("")}</body>`;
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: path.join(OUT, t.file + ".pdf"), width: "1080px", height: "1440px", printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(path.join(OUT, t.file + ".html"), html);
    await page.close();
    console.log("wrote", t.file);
  }
  await browser.close();
}
main();
