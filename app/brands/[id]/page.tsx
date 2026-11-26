"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Wand2, ArrowLeft, BookOpen, Check, Code2, Cpu, History, Info, Layers, ListChecks, Palette, RefreshCw, ShieldCheck, Sparkles, Trash2, Upload } from "lucide-react";
import Shell from "@/components/Shell";
import { Badge, Modal, ProgressPanel, Skeleton, Tabs, btnDanger, btnGhost, btnPrimary, input, toast, useProgress } from "@/components/ui";
import { api, inr, stream, usd } from "@/lib/client";

type Spec = any;
type Lb = { id: number; version: number; is_active: boolean; status: string; fidelity_score: number | null; ingest_cost: { usd: number; inr: number } | null; spec_user_edited: boolean };
type Detail = { lookbook: { id: number; has_kit: boolean; status: string }; spec: Spec | null; report: { warnings: string[]; perArchetype: Record<string, { score: number | null; judge?: number }> } | null; cost: { usd: number; inr: number } };
type Tab = "guidelines" | "style" | "carousels" | "versions";

const METHOD = { code: { label: "Checked by code", icon: Code2, tone: "gray" }, template: { label: "Built into templates", icon: ShieldCheck, tone: "blue" }, review: { label: "AI-reviewed", icon: Cpu, tone: "indigo" }, info: { label: "Context", icon: Info, tone: "gray" } } as const;

function FontSearch({ value, onChange, devanagari = false, label }: { value: string; onChange: (v: string) => void; devanagari?: boolean; label: string }) {
  const [opts, setOpts] = useState<string[]>([]);
  const id = useRef(`fl-${Math.random().toString(36).slice(2)}`).current;
  const t = useRef<any>(null);
  const search = (q: string) => { clearTimeout(t.current); t.current = setTimeout(() => api<{ fonts: { family: string }[] }>(`/api/fonts?q=${encodeURIComponent(q)}${devanagari ? "&devanagari=1" : ""}`).then((r) => setOpts(r.fonts.map((f) => f.family))).catch(() => {}), 250); };
  return (
    <label className="block text-xs font-medium text-neutral-600">{label}
      <input className={`${input} mt-1`} list={id} value={value} onChange={(e) => { onChange(e.target.value); search(e.target.value); }} onFocus={() => search(value)} />
      <datalist id={id}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
    </label>
  );
}

export default function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [brand, setBrand] = useState<{ name: string } | null>(null);
  const [lookbooks, setLookbooks] = useState<Lb[]>([]);
  const [carousels, setCarousels] = useState<any[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Spec | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("guidelines");
  const [stamp, setStamp] = useState(Date.now());
  const [running, setRunning] = useState<string | null>(null);
  const [failed, setFailed] = useState("");
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [delCar, setDelCar] = useState<any | null>(null);
  const [instr, setInstr] = useState(""), [target, setTarget] = useState("all"), [editing, setEditing] = useState(false), [editErr, setEditErr] = useState("");
  const [editInfo, setEditInfo] = useState<{ edits: { at: string; archetypes: string[]; instruction: string; summary: string }[]; canUndo: boolean }>({ edits: [], canUndo: false });
  const [estimate, setEstimate] = useState<{ usd: number; inr: number; note: string } | null>(null);
  const [toDelete, setToDelete] = useState<Lb | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const prog = useProgress();
  const editProg = useProgress();
  const loadEdits = useCallback((lb: number) => api<any>(`/api/lookbooks/${lb}/kit-edit`).then(setEditInfo).catch(() => setEditInfo({ edits: [], canUndo: false })), []);
  async function applyEdit(undo = false) {
    if (!sel) return;
    setEditing(true); setEditErr(""); editProg.reset();
    try {
      const r: any = await stream(`/api/lookbooks/${sel}/kit-edit`, undo ? { undo: true } : { instruction: instr, archetype: target }, editProg.push);
      await loadDetail(sel); await loadEdits(sel); setStamp(Date.now());
      if (undo) toast("Last change undone."); else { toast(r.summary || "Template updated."); setInstr(""); }
    } catch (e: any) { setEditErr(e.message); }
    setEditing(false);
  }

  const loadBrand = useCallback(async () => {
    const r = await api<any>(`/api/brands/${id}`);
    setBrand(r.brand); setLookbooks(r.lookbooks); setCarousels(r.carousels);
    setSel((s) => (s && r.lookbooks.some((l: Lb) => l.id === s) ? s : (r.lookbooks.find((l: Lb) => l.is_active) ?? r.lookbooks[0])?.id ?? null));
  }, [id]);
  const loadDetail = useCallback(async (lb: number) => {
    const d = await api<Detail>(`/api/lookbooks/${lb}`);
    setDetail(d); setDraft(d.spec ? structuredClone(d.spec) : null); setDirty(false); setStamp(Date.now()); setLoading(false); loadEdits(lb);
  }, []);
  useEffect(() => { loadBrand().catch((e) => toast(e.message, "err")); }, [loadBrand]);
  useEffect(() => { if (sel) loadDetail(sel).catch((e) => toast(e.message, "err")); else if (lookbooks.length === 0) setLoading(false); }, [sel, loadDetail, lookbooks.length]);

  const edit = (fn: (s: Spec) => void) => { setDraft((d: Spec | null) => { const n = structuredClone(d); fn(n); return n; }); setDirty(true); };

  async function save() {
    if (!draft || !sel) return;
    setRunning("save");
    try {
      const r = await api<{ warnings: string[]; needsRebuild: boolean; changes: string[] }>(`/api/lookbooks/${sel}/spec`, { method: "PUT", json: { spec: draft } });
      await loadDetail(sel);
      toast(`Saved${r.changes.length ? ` (${r.changes.join(", ")})` : ""}. No AI call, no cost.`);
      if (r.needsRebuild) toast("Structure changed: rebuild the templates to apply it.", "info");
      r.warnings.slice(0, 2).forEach((w) => toast(w, "info"));
    } catch (e: any) { toast(e.message, "err"); }
    setRunning(null);
  }
  /** The server keeps working when the connection drops: wait for the look book's status to leave "ingesting". */
  async function waitForLookbook(lbId: number) {
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const d = await api<any>(`/api/lookbooks/${lbId}`).catch(() => null);
      if (d && d.lookbook.status !== "ingesting") return d.lookbook.status as string;
    }
    return "ingesting";
  }
  async function ingest(lbId: number, force = false) {
    setRunning("ingest"); setFailed(""); prog.reset();
    try { await stream(`/api/lookbooks/${lbId}/ingest${force ? "?force=1" : ""}`, {}, prog.push); await loadBrand(); await loadDetail(lbId); toast("Look book ready."); }
    catch (e: any) {
      if (e.name === "StreamDropped") { const st = await waitForLookbook(lbId); await loadBrand(); await loadDetail(lbId); if (st === "ready") toast("Look book ready."); else setFailed(st === "ingesting" ? "Still working. Reload this page in a few minutes." : "The ingest did not finish. Check the status and try again."); }
      else { setFailed(e.message); await loadBrand(); }
    }
    setRunning(null);
  }
  async function upload(f: File) {
    setRunning("upload"); setFailed(""); prog.reset();
    try { const fd = new FormData(); fd.append("file", f); const { lookbook } = await api<any>(`/api/brands/${id}/lookbooks`, { method: "POST", body: fd }); await loadBrand(); setSel(lookbook.id); await ingest(lookbook.id); }
    catch (e: any) { setFailed(e.message); setRunning(null); }
  }
  async function reread() {
    if (!sel) return; setRunning("reread");
    try { const r = await api<{ guidelines: number; coverage: { blocks: number; mapped: number } }>(`/api/lookbooks/${sel}/upgrade`, { method: "POST" }); await loadDetail(sel); toast(`Re-read the look book: ${r.guidelines} guidelines, ${r.coverage.mapped}/${r.coverage.blocks} text blocks mapped. Free.`); }
    catch (e: any) { toast(e.message, "err"); }
    setRunning(null);
  }
  async function openRebuild() { setEstimate(null); setRebuildOpen(true); api<any>(`/api/lookbooks/${sel}/rebuild`).then(setEstimate).catch((e) => toast(e.message, "err")); }
  async function rebuild(reuse = false) {
    setRebuildOpen(false); setRunning("rebuild"); setFailed(""); prog.reset();
    try { await stream(`/api/lookbooks/${sel}/rebuild`, { reuse }, prog.push); await loadBrand(); await loadDetail(sel!); toast(reuse ? "Templates re-polished (no cost)." : "Templates rebuilt."); } catch (e: any) { if (e.name === "StreamDropped") { const st = await waitForLookbook(sel!); await loadBrand(); await loadDetail(sel!); if (st === "ready") toast("Templates rebuilt."); else setFailed("The rebuild did not finish. Try again."); } else setFailed(e.message); }
    setRunning(null);
  }
  async function removeLb() { if (!toDelete) return; try { await api(`/api/lookbooks/${toDelete.id}`, { method: "DELETE" }); setToDelete(null); await loadBrand(); toast("Version deleted.", "info"); } catch (e: any) { toast(e.message, "err"); setToDelete(null); } }

  const cur = lookbooks.find((l) => l.id === sel);
  const busy = running === "ingest" || running === "rebuild" || running === "upload";
  const gl: any[] = draft?.guidelines ?? [];
  const bySection = useMemo(() => { const m = new Map<string, any[]>(); gl.forEach((g, i) => { const a = m.get(g.section) ?? []; a.push({ ...g, _i: i }); m.set(g.section, a); }); return [...m.entries()]; }, [gl]);
  const counts = useMemo(() => { const c = { code: 0, template: 0, review: 0, info: 0 }; gl.forEach((g) => { if (g.enabled) c[g.method as keyof typeof c]++; }); return c; }, [gl]);
  const lc = (p: string) => (draft?.confidence?.low_confidence_fields ?? []).some((f: string) => f.startsWith(p)) ? "ring-2 ring-amber-300" : "";

  return (
    <Shell wide>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/brands" className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft size={15} />Brands</Link>
        <h1 className="text-2xl font-semibold">{brand?.name ?? "…"}</h1>
        {draft?.colors && <span className="flex gap-1">{draft.colors.map((c: any) => <span key={c.token} className="h-4 w-4 rounded-full ring-1 ring-black/10" style={{ background: c.hex }} title={`${c.name ?? c.token} ${c.hex}`} />)}</span>}
        <div className="ml-auto flex gap-2">
          <Link href={`/create?brand=${id}`} className={btnPrimary}><Sparkles size={15} />Create carousel</Link>
          <label className={`${btnGhost} cursor-pointer`}><Upload size={15} />New version<input type="file" accept="application/pdf" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        </div>
      </div>

      {(busy || failed) && <div className="mt-4 max-w-xl"><ProgressPanel log={prog.log} running={busy} error={failed || undefined} flow="ingest" /></div>}

      <Tabs<Tab> className="mt-5 max-w-2xl" value={tab} onChange={setTab} tabs={[
        { id: "guidelines", label: <><ListChecks size={15} />Guidelines</>, badge: gl.length ? <span className="rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold text-white">{gl.length}</span> : undefined },
        { id: "style", label: <><Palette size={15} />Style</> },
        { id: "carousels", label: <><Layers size={15} />Carousels</>, badge: carousels.length ? <span className="rounded-full bg-neutral-300 px-1.5 text-[10px] font-semibold">{carousels.length}</span> : undefined },
        { id: "versions", label: <><History size={15} />Versions</> },
      ]} />

      {loading && <div className="mt-6 space-y-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}

      {/* ===================== GUIDELINES ===================== */}
      {tab === "guidelines" && draft && detail && (
        <section className="mt-6 pb-24">
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen size={19} />What your look book says</h2>
                <p className="mt-1 text-sm text-neutral-600">Every statement in the look book was read from its structure and turned into a guideline with its page number. Each carousel is held to all of them, and the checklist beside every carousel shows how it did.</p>
                {draft.lookbook?.coverage && <p className="mt-2 text-xs text-neutral-500"><Check size={12} className="mr-1 inline text-emerald-600" />{draft.lookbook.coverage.mapped} of {draft.lookbook.coverage.blocks} text blocks in the PDF were mapped to a section.{draft.lookbook.warnings?.length ? ` Not found: ${draft.lookbook.warnings.join("; ")}` : ""}</p>}
              </div>
              <button className={btnGhost} onClick={reread} disabled={!!running}><RefreshCw size={15} className={running === "reread" ? "animate-spin" : ""} />Re-read look book <span className="text-xs text-neutral-400">free</span></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(METHOD) as (keyof typeof METHOD)[]).map((k) => { const M = METHOD[k]; return <div key={k} className="rounded-xl bg-neutral-50 p-3"><p className="flex items-center gap-1.5 text-xs font-medium text-neutral-600"><M.icon size={14} />{M.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{counts[k]}</p></div>; })}
            </div>
          </div>

          {draft.formats?.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Content formats</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {draft.formats.map((f: any) => (
                  <div key={f.id} className={`card p-3 ${f.kind === "carousel" ? "ring-1 ring-indigo-200" : "opacity-80"}`}>
                    <div className="flex items-center justify-between"><span className="font-medium">{f.name}</span><Badge tone={f.kind === "carousel" ? "indigo" : "gray"}>{f.kind === "carousel" ? "carousel" : "single post"}</Badge></div>
                    <p className="mt-1 text-sm text-neutral-600">{f.description}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-neutral-400">{f.label}{f.slides ? ` · ${f.slides} slides` : ""}{f.stamped ? " · stamped" : ""}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500">Carousels use the carousel formats; the model picks the best one for the topic (you can choose when creating).{draft.lookbook?.cadence ? ` Cadence: ${draft.lookbook.cadence.toLowerCase()}.` : ""}</p>
            </div>
          )}

          <div className="mt-6 space-y-4">
            {bySection.map(([section, items]) => (
              <div key={section} className="card overflow-hidden" data-testid="guideline-section">
                <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setOpen((o) => ({ ...o, [section]: !(o[section] ?? true) }))} aria-expanded={open[section] ?? true}>
                  <span className="font-semibold">{section}<span className="ml-2 text-sm font-normal text-neutral-500">{items.length}</span></span>
                  <span className="text-xs text-neutral-400">p.{[...new Set(items.map((g: any) => g.page))].join(", ")}</span>
                </button>
                {(open[section] ?? true) && (
                  <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                    {items.map((g: any) => { const M = METHOD[g.method as keyof typeof METHOD]; return (
                      <li key={g.id} className={`flex items-start gap-3 px-4 py-2.5 ${g.enabled ? "" : "opacity-50"}`} data-testid="guideline-row">
                        <input type="checkbox" className="mt-1.5 h-4 w-4 accent-indigo-600" checked={g.enabled} onChange={(e) => edit((s) => { s.guidelines[g._i].enabled = e.target.checked; })} aria-label={`${g.statement} enabled`} />
                        <div className="min-w-0 flex-1">
                          <input className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium hover:border-neutral-300 focus:border-indigo-500 focus:bg-white" value={g.statement} onChange={(e) => edit((s) => { s.guidelines[g._i].statement = e.target.value; })} aria-label="Guideline wording" />
                          <p className="px-1.5 text-xs italic text-neutral-500">“{g.quote}”</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1"><Badge tone={M.tone as any} title={M.label}><M.icon size={11} />{M.label}</Badge><span className="text-[11px] text-neutral-400">page {g.page}</span></div>
                      </li>); })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ===================== STYLE ===================== */}
      {tab === "style" && draft && detail && (
        <section className="mt-6 pb-24">
          {(draft.confidence?.low_confidence_fields?.length ?? 0) > 0 && <p className="mb-3 text-sm text-amber-800">Low confidence: {draft.confidence.low_confidence_fields.map((f: string) => <Badge key={f} tone="amber">{f}</Badge>)}</p>}
          {detail.report?.warnings?.filter((w) => !/geometry/i.test(w)).slice(0, 4).map((w, i) => <p key={i} className="mb-1 text-xs text-neutral-500">Note: {w}</p>)}

          <h3 className="font-semibold">Colours</h3>
          <div className={`mt-2 grid gap-3 rounded-2xl p-1 sm:grid-cols-2 ${lc("colors")}`}>
            {draft.colors.map((c: any, i: number) => (
              <div key={c.token} className="card flex gap-3 p-3" data-testid="colour-row">
                <input type="color" aria-label={`${c.token} colour`} value={c.hex} onChange={(e) => edit((s) => { s.colors[i].hex = e.target.value.toUpperCase(); })} className="h-16 w-16 cursor-pointer rounded-xl border border-neutral-300" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{c.name ?? c.token}</span><input className={`${input} w-28 py-1 font-mono`} value={c.hex} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && edit((s) => { s.colors[i].hex = e.target.value.toUpperCase(); })} aria-label={`${c.token} hex`} /></div>
                  {c.roles?.length > 0 && <p className="text-xs text-neutral-500">Used for: {c.roles.join(", ").toLowerCase()}</p>}
                  <input className={`${input} py-1 text-xs`} value={c.usage_notes} placeholder="usage notes" onChange={(e) => edit((s) => { s.colors[i].usage_notes = e.target.value; })} aria-label={`${c.token} usage`} />
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-7 font-semibold">Fonts <span className="text-xs font-normal text-neutral-500">(Latin family and its Devanagari pair, searched on Google Fonts)</span></h3>
          <div className={`mt-2 grid gap-3 rounded-2xl p-1 lg:grid-cols-3 ${lc("fonts")}`}>
            {draft.fonts.map((f: any, i: number) => (
              <div key={f.role} className="card space-y-2 p-3" data-testid="font-row">
                <div className="flex items-center gap-2"><span className="text-sm font-semibold capitalize">{f.role}</span>{f.substituted && <Badge tone="amber">substituted</Badge>}</div>
                {f.roles?.length > 0 && <p className="text-xs text-neutral-500">For {f.roles.join(", ").toLowerCase()}</p>}
                <FontSearch label="Latin family" value={f.google_fonts_family ?? f.family} onChange={(v) => edit((s) => { s.fonts[i].google_fonts_family = v; })} />
                <FontSearch label="Devanagari pair" devanagari value={f.devanagari_pair} onChange={(v) => edit((s) => { s.fonts[i].devanagari_pair = v; })} />
                <label className="block text-xs font-medium text-neutral-600">Weights<input className={`${input} mt-1`} value={f.weights.join(", ")} onChange={(e) => edit((s) => { s.fonts[i].weights = e.target.value.split(/[ ,]+/).map(Number).filter((n) => n >= 100 && n <= 900); })} /></label>
              </div>
            ))}
          </div>

          <h3 className="mt-7 font-semibold">Elements <span className="text-xs font-normal text-neutral-500">(switching one off applies when you rebuild the templates)</span></h3>
          <ul className="card mt-2 divide-y divide-[var(--line)]">
            {draft.elements.map((e: any, i: number) => (
              <li key={e.id} className="flex items-start gap-3 p-3 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={e.enabled !== false} onChange={(ev) => edit((s) => { s.elements[i].enabled = ev.target.checked; })} aria-label={`${e.id} enabled`} />
                <div><span className="font-medium">{e.id}</span> <Badge>{e.kind}</Badge>{e.rotation_deg ? <Badge>{e.rotation_deg}°</Badge> : null}{e.max_per_slide ? <Badge>max {e.max_per_slide}/slide</Badge> : null}<p className="text-neutral-600">{e.description}</p></div>
              </li>
            ))}
          </ul>

          <h3 className="mt-7 font-semibold">Templates</h3>
          {detail.lookbook.has_kit && (() => {
            const per = detail.report?.perArchetype ?? {}, rows = draft.archetypes.map((a: any) => ({ id: a.id, score: per[a.id]?.score as number | null | undefined })), weak = rows.filter((r: any) => r.score != null && r.score < 70), unm = rows.filter((r: any) => r.score == null);
            const tone = weak.length ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50";
            return (
              <div className={`mt-2 rounded-xl border p-3 text-sm ${tone}`} data-testid="kit-quality">
                <p className="font-medium">{weak.length ? `${weak.length} of ${rows.length} templates need a look before you create carousels` : "Templates match your look book well"}</p>
                <p className="mt-0.5 text-xs text-neutral-600">{rows.filter((r: any) => r.score != null && r.score >= 85).length} excellent (85+), {rows.filter((r: any) => r.score != null && r.score >= 70 && r.score < 85).length} good (70–84){weak.length ? `, ${weak.length} weak: ${weak.map((r: any) => `${r.id} (${Math.round(r.score)})`).join(", ")}` : ""}{unm.length ? `. ${unm.length} built from the written rules because the look book has no sample of ${unm.map((r: any) => r.id).join(", ")}` : ""}.</p>
                <div className="mt-2 flex flex-wrap gap-2"><button className={btnGhost} onClick={() => rebuild(true)} disabled={busy} title="Re-runs the automatic layout fixes on the saved templates. No model call, no cost.">Re-polish templates (free)</button>{weak.length > 0 && <button className={btnGhost} onClick={openRebuild} disabled={busy}>Rebuild from scratch</button>}</div>
              </div>
            );
          })()}
          {detail.lookbook.has_kit && (
            <div className="card mt-3 p-4" data-testid="kit-edit">
              <h3 className="flex items-center gap-1.5 font-semibold"><Wand2 size={16} />Fix a template with instructions</h3>
              <p className="mt-0.5 text-xs text-neutral-500">Say what is wrong and the template is changed in place, instead of being rebuilt. Costs about ₹2 to ₹6. Your change is kept when the templates are re-polished.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[14rem_1fr]">
                <select className={input} value={target} onChange={(e) => setTarget(e.target.value)} disabled={editing} aria-label="Template to change">
                  <option value="all">Any template (let it decide)</option>
                  {draft.archetypes.map((a: any) => <option key={a.id} value={a.id}>{a.id}</option>)}
                </select>
                <textarea className={input} rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} disabled={editing} placeholder="e.g. Make the quiz option text bigger and give the boxes more space between them" aria-label="Instruction" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button className={btnPrimary} disabled={editing || busy || instr.trim().length < 4} onClick={() => applyEdit(false)}><Wand2 size={15} />{editing ? "Working…" : "Make the change"}</button>
                {editInfo.canUndo && <button className={btnGhost} disabled={editing || busy} onClick={() => applyEdit(true)}>Undo last change</button>}
              </div>
              {(editing || editErr) && <div className="mt-3 max-w-xl"><ProgressPanel log={editProg.log} running={editing} error={editErr || undefined} flow="edit" /></div>}
              {editInfo.edits.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3 text-xs" data-testid="kit-edit-history">
                  {[...editInfo.edits].reverse().slice(0, 6).map((e, i) => <li key={i}><span className="font-medium">{e.instruction}</span><span className="text-neutral-500"> → {e.summary}{e.archetypes.length ? ` (${e.archetypes.join(", ")})` : ""}</span></li>)}
                </ul>
              )}
            </div>
          )}
          <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {draft.archetypes.map((a: any, ai: number) => (
              <div key={a.id} className="card overflow-hidden" data-testid="archetype-card">
                <div className="aspect-[4/5] bg-neutral-100">{detail.lookbook.has_kit ? <img src={`/api/lookbooks/${sel}/preview/${a.id}?v=${stamp}`} alt={`${a.id} preview`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-neutral-400">No templates built yet</div>}</div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center justify-between"><span className="font-medium">{a.id}</span>{detail.report?.perArchetype?.[a.id]?.score != null && <Badge tone="blue" title="How closely this template matches the look book's own sample">fidelity {Math.round(detail.report.perArchetype[a.id].score!)}</Badge>}</div>
                  <p className="text-xs text-neutral-500">{a.purpose}: {a.description}</p>
                  <label className="block text-xs font-medium text-neutral-600">Background colour
                    <select className={`${input} mt-1 py-1`} value={a.background_token} onChange={(e) => edit((s) => { s.archetypes[ai].background_token = e.target.value; })}>{draft.colors.map((c: any) => <option key={c.token} value={c.token}>{c.name ?? c.token}</option>)}</select>
                  </label>
                  <table className="w-full text-xs"><thead><tr className="text-left text-neutral-500"><th>Slot</th><th>words</th><th>chars</th></tr></thead><tbody>
                    {a.slots.map((sl: any, si: number) => (
                      <tr key={sl.name}><td className="py-0.5 pr-2">{sl.name}<span className="text-neutral-400"> {sl.kind}</span></td>
                        <td><input type="number" min={1} className={`${input} w-16 py-0.5`} value={sl.max_words} aria-label={`${a.id} ${sl.name} max words`} onChange={(e) => edit((s) => { s.archetypes[ai].slots[si].max_words = Math.max(1, Number(e.target.value)); })} /></td>
                        <td><input type="number" min={1} className={`${input} w-20 py-0.5`} value={sl.max_chars} aria-label={`${a.id} ${sl.name} max chars`} onChange={(e) => edit((s) => { s.archetypes[ai].slots[si].max_chars = Math.max(1, Number(e.target.value)); })} /></td></tr>
                    ))}
                  </tbody></table>
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-7 font-semibold">Rules <span className="text-xs font-normal text-neutral-500">(machine-checked forms; the wording lives in Guidelines)</span></h3>
          <ul className="mt-2 space-y-2">
            {draft.rules.map((r: any, i: number) => (
              <li key={i} className="card p-3 text-sm" data-testid="rule-row">
                <div className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={r.enabled !== false} onChange={(e) => edit((s) => { s.rules[i].enabled = e.target.checked; })} aria-label={`rule ${i + 1} enabled`} /><input className={input} value={r.text} onChange={(e) => edit((s) => { s.rules[i].text = e.target.value; })} aria-label={`rule ${i + 1} text`} />{r.machine ? <Badge tone="blue">checked by code</Badge> : <Badge>prose</Badge>}</div>
                {r.machine && <label className="mt-2 block text-xs text-neutral-600">{r.machine.type} parameters (JSON)<input className={`${input} mt-1 font-mono text-xs`} defaultValue={JSON.stringify(r.machine.params)} onBlur={(e) => { try { const p = JSON.parse(e.target.value); edit((s) => { s.rules[i].machine.params = p; }); e.target.classList.remove("!border-rose-500"); } catch { e.target.classList.add("!border-rose-500"); } }} /></label>}
              </li>
            ))}
          </ul>

          <h3 className="mt-7 font-semibold">Voice</h3>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            <label className="block text-xs font-medium text-neutral-600 md:col-span-3">Summary<textarea rows={2} className={`${input} mt-1`} value={draft.voice.summary} onChange={(e) => edit((s) => { s.voice.summary = e.target.value; })} /></label>
            {(["do", "dont", "examples"] as const).map((k) => (
              <label key={k} className="block text-xs font-medium text-neutral-600">{k === "dont" ? "Don't" : k === "do" ? "Do" : "Example lines"} (one per line)<textarea rows={5} className={`${input} mt-1`} value={draft.voice[k].join("\n")} onChange={(e) => edit((s) => { s.voice[k] = e.target.value.split("\n").filter((x) => x.trim()); })} /></label>
            ))}
          </div>
        </section>
      )}

      {/* ===================== CAROUSELS ===================== */}
      {tab === "carousels" && (
        <section className="mt-6 pb-10">
          {carousels.length === 0 ? <div className="card p-10 text-center text-sm text-neutral-500">No carousels yet. <Link className="font-medium text-indigo-700 underline" href={`/create?brand=${id}`}>Create the first one</Link>.</div> : (
            <ul className="card divide-y divide-[var(--line)] text-sm">
              {carousels.map((c) => <li key={c.id} className="flex items-center"><Link href={`/carousel/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 p-3.5 hover:bg-neutral-50"><span className="min-w-0 flex-1 truncate font-medium">{c.topic}</span><Badge>{c.language}</Badge><span className="text-neutral-500">{c.n_slides} slides</span><Badge tone={c.status === "ready" ? "green" : c.status === "needs_review" ? "amber" : "gray"}>{c.status.replace("_", " ")}</Badge></Link><button className="mr-2 rounded-lg p-2 text-neutral-400 hover:bg-rose-50 hover:text-rose-700" aria-label={`Delete carousel: ${c.topic}`} title="Delete" onClick={() => setDelCar(c)}><Trash2 size={16} /></button></li>)}
            </ul>
          )}
        </section>
      )}

      {/* ===================== VERSIONS ===================== */}
      {tab === "versions" && (
        <section className="mt-6 pb-10">
          <div className="card divide-y divide-[var(--line)]">
            {lookbooks.map((l) => (
              <div key={l.id} className={`flex flex-wrap items-center gap-3 p-3.5 text-sm ${l.id === sel ? "bg-neutral-50" : ""}`} data-testid="lookbook-row">
                <button className="font-semibold underline-offset-2 hover:underline" onClick={() => { setSel(l.id); setTab("guidelines"); }}>Version {l.version}</button>
                {l.is_active && <Badge tone="green">active</Badge>}
                <Badge tone={l.status === "ready" ? "blue" : l.status === "failed" ? "red" : "amber"}>{l.status}</Badge>
                {l.spec_user_edited && <Badge>edited</Badge>}
                {l.fidelity_score != null && <span className="text-neutral-600">fidelity {l.fidelity_score}</span>}
                {l.ingest_cost && <span className="text-neutral-600">read for {usd(l.ingest_cost.usd)} / {inr(l.ingest_cost.inr)} once</span>}
                <span className="ml-auto flex gap-2">
                  {(l.status === "failed" || l.status === "new") && <button className={btnPrimary} disabled={busy} onClick={() => { setSel(l.id); ingest(l.id); }}>Run ingest</button>}
                  {!l.is_active && l.status === "ready" && <button className={btnGhost} onClick={async () => { await api(`/api/lookbooks/${l.id}`, { method: "PATCH", json: { active: true } }); loadBrand(); toast("Version set active."); }}>Set active</button>}
                  <button className={btnDanger} onClick={() => setToDelete(l)}><Trash2 size={14} />Delete</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {draft && (tab === "guidelines" || tab === "style") && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
            <span className="text-sm text-neutral-600">{dirty ? "Unsaved changes" : "All changes saved"}</span>
            <span className="ml-auto flex gap-2">
              <button className={btnGhost} disabled={!dirty || !!running} onClick={() => sel && loadDetail(sel)}>Discard</button>
              <button className={btnGhost} disabled={!!running || dirty} title={dirty ? "Save first" : ""} onClick={openRebuild}>Rebuild templates…</button>
              <button className={btnPrimary} disabled={!dirty || !!running} onClick={save}>{running === "save" ? "Saving…" : "Save changes"}</button>
            </span>
          </div>
        </div>
      )}

      <Modal open={rebuildOpen} onClose={() => setRebuildOpen(false)} title="Rebuild the templates?">
        {estimate ? (
          <>
            <p className="text-sm text-neutral-700">This asks the vision model to regenerate the templates from your edited spec and re-measures them against your PDF.</p>
            <p className="mt-3 text-lg font-semibold">Estimated cost: {usd(estimate.usd)} ({inr(estimate.inr)})</p>
            <p className="mt-1 text-xs text-neutral-500">{estimate.note}</p>
            <div className="mt-4 flex justify-end gap-2"><button className={btnGhost} onClick={() => setRebuildOpen(false)}>Cancel</button><button className={btnPrimary} onClick={() => rebuild(false)}>Rebuild now</button></div>
          </>
        ) : <p className="text-sm text-neutral-500">Estimating cost…</p>}
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete version ${toDelete?.version}?`}>
        <p className="text-sm text-neutral-600">Deletes this look book version and its templates. A brand's last remaining version can't be deleted: delete the brand instead.</p>
        <div className="mt-4 flex justify-end gap-2"><button className={btnGhost} onClick={() => setToDelete(null)}>Cancel</button><button className={btnDanger} onClick={removeLb}>Delete</button></div>
      </Modal>
          <Modal open={!!delCar} onClose={() => setDelCar(null)} title="Delete this carousel?">
        <p className="text-sm text-neutral-600">"{delCar?.topic}" and its slides, PDFs, PNGs and captions will be removed. This can't be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} onClick={() => setDelCar(null)}>Keep it</button>
          <button className={btnDanger} onClick={async () => { const c = delCar; setDelCar(null); try { await api(`/api/carousels/${c.id}`, { method: "DELETE" }); setCarousels((x) => x.filter((y) => y.id !== c.id)); toast("Carousel deleted."); } catch (e: any) { toast(`Could not delete: ${e.message}`, "err"); } }}>Delete carousel</button>
        </div>
      </Modal>
</Shell>
  );
}
