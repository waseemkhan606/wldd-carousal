// Runs INSIDE Chromium. Kept as a plain string (not a TS function) so no bundler/transpiler helpers get injected.
// Exposes window.__cs.render(payload) -> diagnostics.
export const PAGE_SCRIPT = String.raw`
(() => {
  const W = 1080, H = 1350;
  const SAMPLE_DEVA = "क्ष त्र श्र";
  async function ensureFonts(families) {
    // document.fonts.check() returns true when no face matches, so it can't prove a font loaded. load() can.
    const missing = [];
    for (const f of families.latin) { const r = await document.fonts.load('400 40px "' + f + '"', "Ag"); if (!r.length) missing.push(f + " (latin)"); }
    for (const f of families.devanagari) { const r = await document.fonts.load('400 40px "' + f + '"', SAMPLE_DEVA); if (!r.length) missing.push(f + " (devanagari)"); }
    await document.fonts.ready;
    return missing;
  }
  // Inline emphasis: *word* becomes <em>word</em>. Built with DOM nodes (never innerHTML) so text stays text.
  // Markers must hug non-space characters, so "2 * 3 * 4" is left alone.
  const EMPH = /\*(?=\S)([^*\n]*?\S)\*/g;
  const plain = (t) => t.replace(EMPH, "$1");
  function setText(el, t) {
    el.textContent = "";
    // one inline wrapper keeps emphasised text in a single flow even when the slot is a flex container (otherwise each piece becomes its own flex item and breaks onto its own line)
    EMPH.lastIndex = 0; const host = EMPH.test(t) ? el.appendChild(document.createElement("span")) : el;
    let last = 0, m; EMPH.lastIndex = 0;
    while ((m = EMPH.exec(t))) {
      if (m.index > last) host.appendChild(document.createTextNode(t.slice(last, m.index)));
      const em = document.createElement("em"); em.textContent = m[1]; host.appendChild(em);
      last = m.index + m[0].length;
    }
    if (last < t.length) host.appendChild(document.createTextNode(t.slice(last)));
  }
  function subst(root, vars) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      if (n.nodeValue.includes("{{")) n.nodeValue = n.nodeValue.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    }
  }
  // Bounds of the text itself (not the box), so a wide box can't hide text running into the margin.
  function textRect(el) {
    const rg = document.createRange(); rg.selectNodeContents(el);
    return rg.getBoundingClientRect();
  }
  let SAFE = { top: 0, right: 0, bottom: 0, left: 0 };
  const SLACK = 8;
  function inside(el, rootRect) {
    const r = el.getBoundingClientRect();
    if (!(r.left >= rootRect.left - 1 && r.top >= rootRect.top - 1 && r.right <= rootRect.right + 1 && r.bottom <= rootRect.bottom + 1)) return false;
    const t = textRect(el);
    if (!t.width) return true;
    return t.left >= rootRect.left + SAFE.left - SLACK && t.right <= rootRect.right - SAFE.right + SLACK
        && t.top >= rootRect.top + SAFE.top - SLACK && t.bottom <= rootRect.bottom - SAFE.bottom + SLACK;
  }
  function overlap(a, b) {
    return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 4 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 4;
  }
  function fits(el, rootRect) {
    // Fonts' content area (ascent+descent) can exceed a tight line-height by a few % of the font size without any
    // visible clipping, so allow 0.12em vertically; horizontal overflow gets only rounding slack.
    const tol = Math.ceil(parseFloat(getComputedStyle(el).fontSize) * 0.12);
    return el.scrollHeight <= el.clientHeight + tol && el.scrollWidth <= el.clientWidth + 1 && inside(el, rootRect);
  }
  function fit(el, rootRect) {
    const cs = getComputedStyle(el);
    const designed = parseFloat(cs.fontSize);
    const max = parseFloat(el.dataset.maxSize || "") || designed;
    const min = parseFloat(el.dataset.minSize || "") || Math.max(12, Math.round(max * 0.5));
    el.style.fontSize = max + "px";
    if (fits(el, rootRect)) return { size: max, overflow: false };
    let lo = Math.floor(min), hi = Math.floor(max), best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; el.style.fontSize = mid + "px";
      if (fits(el, rootRect)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best === null) { el.style.fontSize = Math.floor(min) + "px"; return { size: Math.floor(min), overflow: true }; }
    el.style.fontSize = best + "px";
    return { size: best, overflow: false };
  }
  function sideOk(pos, r, rootRect) {
    const cx = (r.left + r.right) / 2 - rootRect.left, cy = (r.top + r.bottom) / 2 - rootRect.top;
    const p = pos.toLowerCase(); const bad = [];
    if (/\btop\b/.test(p) && !(cy < H / 2)) bad.push("top");
    if (/\bbottom\b/.test(p) && !(cy > H / 2)) bad.push("bottom");
    if (/\bleft\b/.test(p) && !(cx < W / 2)) bad.push("left");
    if (/\bright\b/.test(p) && !(cx > W / 2)) bad.push("right");
    return bad;
  }
  // Content slots must never print over each other: shrink the upper one, and if it is already at its minimum, push the lower one down.
  function resolveCollisions(els, rootRect) {
    const live = () => els.filter((e) => getComputedStyle(e).display !== "none" && e.textContent);
    for (let pass = 0; pass < 14; pass++) {
      const L = live(); let hit = null;
      for (let i = 0; i < L.length && !hit; i++) for (let j = i + 1; j < L.length; j++) if (!L[i].contains(L[j]) && !L[j].contains(L[i]) && overlap(textRect(L[i]), textRect(L[j]))) { hit = [L[i], L[j]]; break; }
      if (!hit) return;
      const [a, b] = textRect(hit[0]).top <= textRect(hit[1]).top ? hit : [hit[1], hit[0]];
      const min = parseFloat(a.dataset.minSize || "") || 12, cur = parseFloat(getComputedStyle(a).fontSize);
      if (cur > min + 0.5) { a.style.fontSize = Math.max(min, Math.floor(cur * 0.93)) + "px"; continue; }
      const gap = textRect(a).bottom - textRect(b).top + 6, tr = (getComputedStyle(b).translate || "0px 0px").split(/\s+/).map(parseFloat);
      if (textRect(b).bottom + gap < rootRect.bottom - SAFE.bottom) { b.style.translate = (tr[0] || 0) + "px " + ((tr[1] || 0) + gap) + "px"; continue; }
      return;
    }
  }
  window.__cs = {
    ensureFonts,
    async render(p) {
      const root = document.getElementById("root");
      root.innerHTML = p.html;
      subst(root, p.vars || {});
      const missingFonts = await ensureFonts(p.families);
      const rootRect = root.getBoundingClientRect();
      SAFE = p.margins || SAFE;
      const rb = root.firstElementChild ? getComputedStyle(root.firstElementChild).backgroundColor : "";
      const diag = { rootBg: rb, collisions: [], rootSize: { w: Math.round(rootRect.width), h: Math.round(rootRect.height) }, contentOverflow: root.scrollWidth > W || root.scrollHeight > H, missingFonts, slots: {}, missingSlots: [], extraSlots: [], furniture: [], furnitureMisplaced: [] };
      const els = [...root.querySelectorAll("[data-slot]")];
      for (const el of els) {
        const name = el.getAttribute("data-slot");
        if (!(name in p.slots)) { diag.extraSlots.push(name); el.hidden = true; continue; }
        setText(el, p.slots[name]);
        el.style.whiteSpace = el.style.whiteSpace || "pre-line";
        if (p.polish) {
          // typographic polish: balanced short display lines, no orphans in running text, no automatic hyphenation
          const k = (p.kinds || {})[name];
          el.style.textWrap = /headline|number|cta|stamp|tag/.test(k) ? "balance" : /body|list/.test(k) ? "pretty" : "";
          el.style.hyphens = "manual";
        }
      }
      await document.fonts.ready;
      for (const el of els) {
        const name = el.getAttribute("data-slot");
        if (!(name in p.slots)) continue;
        const f = plain(p.slots[name]) === "" ? { size: parseFloat(getComputedStyle(el).fontSize), overflow: false } : fit(el, rootRect);
        const tr = textRect(el); diag.slots[name] = { ...f, textOk: el.textContent === plain(p.slots[name]), rect: { x: tr.left - rootRect.left, y: tr.top - rootRect.top, w: tr.width, h: tr.height }, elW: el.getBoundingClientRect().width, ls: parseFloat(getComputedStyle(el).letterSpacing) || 0, ff: getComputedStyle(el).fontFamily, color: getComputedStyle(el).color, bg: (() => { let n = el; for (let i = 0; i < 4 && n && n !== root.firstElementChild; i++, n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(.*,\s*0\)|transparent/.test(c)) return c; } return ""; })(), bd: (() => { let n = el; for (let i = 0; i < 4 && n && n !== root.firstElementChild; i++, n = n.parentElement) { const st = getComputedStyle(n); if (parseFloat(st.borderTopWidth) > 0 && st.borderTopStyle !== "none") return st.borderTopColor; } return ""; })(), lh: parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2 };
      }
      // an empty optional slot disappears together with a wrapper that exists only for it (e.g. a stamp box)
      for (const el of els) {
        const name = el.getAttribute("data-slot");
        if ((name in p.slots) && plain(p.slots[name]).trim() !== "") continue; // absent and empty slots both vanish with their wrapper
        el.style.display = "none";
        let up = el.parentElement;
        while (up && up !== root && !up.classList.contains("slide") && !up.querySelector("[data-furniture]") && up.textContent.trim() === "") { up.style.display = "none"; up = up.parentElement; }
      }
      resolveCollisions(els, rootRect);
      for (const el of els) { const nm = el.getAttribute("data-slot"); if (diag.slots[nm]) { const tr = textRect(el); diag.slots[nm].size = parseFloat(getComputedStyle(el).fontSize); diag.slots[nm].rect = { x: tr.left - rootRect.left, y: tr.top - rootRect.top, w: tr.width, h: tr.height }; } }
      for (const n of p.slotNames) if (!els.some((e) => e.getAttribute("data-slot") === n)) diag.missingSlots.push(n);
      // per-word boxes (for matching against the reference geometry)
      diag.words = [];
      for (const el of [...els.filter((e) => !e.hidden), ...root.querySelectorAll("[data-furniture]")]) {
        const n = el.getAttribute("data-slot") || el.getAttribute("data-furniture");
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let tn;
        while ((tn = tw.nextNode())) {
          for (const m of tn.nodeValue.matchAll(/\S+/g)) {
            const rg = document.createRange(); rg.setStart(tn, m.index); rg.setEnd(tn, m.index + m[0].length);
            const r = rg.getBoundingClientRect(); if (!r.width) continue;
            diag.words.push({ t: m[0], n, x: r.left - rootRect.left, y: r.top - rootRect.top, w: r.width, h: r.height });
          }
        }
      }
      // text-vs-text collisions among slots and furniture (tight text bounds, 4px tolerance)
      const boxes = [...els.filter((e) => !e.hidden && e.textContent), ...root.querySelectorAll("[data-furniture]")].map((e) => ({ e, n: e.getAttribute("data-slot") || e.getAttribute("data-furniture"), r: textRect(e) })).filter((b) => b.r.width > 0);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (!boxes[i].e.contains(boxes[j].e) && !boxes[j].e.contains(boxes[i].e) && overlap(boxes[i].r, boxes[j].r)) diag.collisions.push(boxes[i].n + " overlaps " + boxes[j].n);
      for (const el of root.querySelectorAll("[data-furniture]")) {
        const what = el.getAttribute("data-furniture"); diag.furniture.push(what);
        { const cs = getComputedStyle(el), rr = textRect(el); (diag.furnStats = diag.furnStats || {})[what] = { size: parseFloat(cs.fontSize), elW: el.getBoundingClientRect().width, ls: parseFloat(cs.letterSpacing) || 0, ff: cs.fontFamily, overflow: false, textOk: true, rect: { x: rr.left - rootRect.left, y: rr.top - rootRect.top, w: rr.width, h: rr.height } }; }
        const want = (p.furniturePositions || {})[what];
        const shown = getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0; // hidden furniture has nothing to place
        if (want && shown) { const bad = sideOk(want, el.getBoundingClientRect(), rootRect); if (bad.length) diag.furnitureMisplaced.push(what + " should be " + want + " but is not on the " + bad.join("/") + " side"); }
      }
      return diag;
    },
  };
})();
`;
