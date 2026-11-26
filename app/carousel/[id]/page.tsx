"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, FileText, Layers, ListChecks, Loader2, PencilLine, ReceiptText, RefreshCw, Trash2, Wand2 } from "lucide-react";
import Shell from "@/components/Shell";
import Checklist, { type CL } from "@/components/Checklist";
import { Badge, Modal, Skeleton, Tabs, btnAccent, btnDanger, btnGhost, btnPrimary, input, toast } from "@/components/ui";
import { api, inr, usd } from "@/lib/client";

type Platform = "instagram" | "linkedin";
type SlideCopy = { idx: number; archetype: string; slots: Record<string, string>; overrides?: Partial<Record<Platform, Record<string, string>>> };
type Detail = {
  carousel: { id: number; brand_id: number; topic: string; language: string; status: string; flags: Record<string, string[]>; copy: { format?: string; slides: SlideCopy[]; captions: Record<Platform, { text: string; hashtags: string[] }>; sources_note?: string; cover?: { considered: number; picked: number; angle?: string; reason: string } } };
  slides: { id: number; idx: number; version: number }[];
  cost: { carousel: { rows: any[]; usd: number; inr: number }; ingest_one_time: { usd: number; inr: number }; ingest_amortised_over_carousels_so_far: { usd: number; inr: number; carousels: number } };
  kit: { brand: string; archetypes: { id: string; slots: { name: string; kind: string; optional: boolean; max_words: number; max_chars: number }[] }[] } | null;
};
const words = (t: string) => t.replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1").trim().split(/\s+/).filter(Boolean).length;
const DL = [["all", "Everything (ZIP)"], ["instagram_pdf", "Instagram PDF"], ["instagram_zip", "Instagram PNGs"], ["linkedin_pdf", "LinkedIn PDF"], ["captions", "Captions"], ["cost", "Cost report"]] as const;
type Tab = "checklist" | "edit" | "captions" | "cost";

export default function CarouselPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<Detail | null>(null);
  const [cl, setCl] = useState<CL | null>(null);
  const [clErr, setClErr] = useState("");
  const [clLoading, setClLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [idx, setIdx] = useState(1);
  const [tab, setTab] = useState<Tab>("checklist");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [archetype, setArchetype] = useState("");
  const [regen, setRegen] = useState(false);
  const router = useRouter();
  const [delOpen, setDelOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadChecklist = useCallback(() => { setClLoading(true); return api<CL>(`/api/carousels/${id}/checklist`).then((c) => { setCl(c); setClErr(""); }).catch((e) => setClErr(e.message)).finally(() => setClLoading(false)); }, [id]);
  const load = useCallback(() => api<Detail>(`/api/carousels/${id}`).then(setD).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); loadChecklist(); }, [load, loadChecklist]);
  useEffect(() => { setDrafts({}); setArchetype(""); }, [idx]);

  const n = d?.carousel.copy.slides.length ?? 0;
  const go = useCallback((i: number) => setIdx((c) => Math.min(Math.max(1, i), n || 1)), [n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (/INPUT|TEXTAREA|SELECT/.test(t.tagName)) return; if (e.key === "ArrowRight") setIdx((c) => Math.min(c + 1, n)); if (e.key === "ArrowLeft") setIdx((c) => Math.max(c - 1, 1)); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [n]);

  const slide = d?.carousel.copy.slides.find((s) => s.idx === idx);
  const row = d?.slides.find((s) => s.idx === idx);
  const arch = useMemo(() => d?.kit?.archetypes.find((a) => a.id === slide?.archetype), [d, slide]);
  const failing = useMemo(() => new Set((cl?.items ?? []).filter((i) => i.status === "fail").flatMap((i) => i.slides)), [cl]);
  const valueOf = (slot: string) => drafts[slot] ?? slide?.overrides?.[platform]?.[slot] ?? slide?.slots[slot] ?? "";
  const platformSpecific = (slot: string) => !!slide?.overrides?.[platform] && slot in slide.overrides[platform]!;

  async function saveSlot(slot: string) {
    if (drafts[slot] === undefined) return;
    setSaving(slot);
    try {
      const r = await api<{ issues: { msg: string }[] }>(`/api/carousels/${id}/slides/${idx}`, { method: "PATCH", json: { platform: platformSpecific(slot) ? platform : "both", slot, text: drafts[slot] } });
      setDrafts((x) => { const c = { ...x }; delete c[slot]; return c; });
      toast(r.issues.length ? "Saved. Some limits still need attention." : "Saved and re-rendered. No AI call, no cost.", r.issues.length ? "info" : "ok");
      await Promise.all([load(), loadChecklist()]);
    } catch (e: any) { toast(`Could not save: ${e.message}`, "err"); }
    setSaving(null);
  }
  async function regenerate() {
    if (!row) return; setRegen(true);
    try { await api(`/api/slides/${row.id}/regen`, { method: "POST", json: { instruction, archetype: archetype || undefined } }); setInstruction(""); toast("Slide regenerated. The other slides were not touched."); await Promise.all([load(), loadChecklist()]); }
    catch (e: any) { toast(`Regeneration failed: ${e.message}`, "err"); }
    setRegen(false);
  }
  async function recheck() {
    setRechecking(true);
    try { const r = await api<{ reviewed: number; checklist: CL }>(`/api/carousels/${id}/checklist`, { method: "POST" }); setCl(r.checklist); toast(`AI check done: ${r.reviewed} guideline${r.reviewed === 1 ? "" : "s"} reviewed.`); await load(); }
    catch (e: any) { toast(`AI check unavailable: ${e.message}`, "err"); }
    setRechecking(false);
  }

  if (error) return <Shell><p role="alert" className="text-rose-700">{error}</p></Shell>;
  if (!d) return <Shell wide><div className="grid gap-5 lg:grid-cols-[6rem_minmax(0,30rem)_1fr]"><Skeleton className="h-96" /><Skeleton className="aspect-[4/5]" /><Skeleton className="h-[34rem]" /></div></Shell>;
  const c = d.carousel, png = (i: number, v: number) => `/api/carousels/${id}/png/${platform}/${i}?v=${v}`, cap = c.copy.captions[platform], fails = cl?.summary.fail ?? 0;
  const format = c.copy.format ? c.copy.format.replace(/-/g, " ") : "";

  return (
    <Shell wide>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href={`/brands/${c.brand_id}`} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"><ArrowLeft size={15} />{d.kit?.brand ?? "Brand"}</Link>
        <h1 className="min-w-0 max-w-3xl truncate text-xl font-semibold" title={c.topic}>{c.topic}</h1>
        <Badge>{c.language === "hi" ? "हिंदी" : c.language === "hinglish" ? "Hinglish" : "English"}</Badge>
        {format && <Badge tone="indigo"><Layers size={11} />{format}</Badge>}
        {cl && <Badge tone={fails ? "red" : cl.summary.pending ? "amber" : "green"}>{fails ? `${fails} to fix` : cl.summary.pending ? `${cl.summary.pending} to decide` : "all guidelines followed"}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <button className={btnDanger} onClick={() => setDelOpen(true)} aria-label="Delete this carousel" title="Delete this carousel"><Trash2 size={15} /><span className="hidden sm:inline">Delete</span></button>
          <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 bg-white" role="tablist" aria-label="Platform">
            {(["instagram", "linkedin"] as Platform[]).map((p) => <button key={p} role="tab" aria-selected={platform === p} onClick={() => setPlatform(p)} className={`px-3.5 py-1.5 text-sm font-medium transition ${platform === p ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}>{p === "instagram" ? "Instagram" : "LinkedIn"}</button>)}
          </div>
          <details className="relative">
            <summary className={`${btnPrimary} cursor-pointer list-none`}><Download size={15} />Download</summary>
            <div className="pop card absolute right-0 z-30 mt-2 w-52 p-1.5 shadow-xl">{DL.map(([k, label]) => <a key={k} href={`/api/export/${id}?kind=${k}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-neutral-100">{label}</a>)}</div>
          </details>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[5.5rem_minmax(0,29rem)_minmax(0,1fr)] xl:grid-cols-[5.5rem_minmax(0,32rem)_minmax(0,1fr)]">
        {/* slide rail */}
        <div className="thin-scroll flex gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100vh-9rem)] lg:flex-col lg:overflow-y-auto lg:pb-0" data-testid="strip">
          {c.copy.slides.map((s) => { const r = d.slides.find((x) => x.idx === s.idx)!; return (
            <button key={s.idx} onClick={() => setIdx(s.idx)} aria-label={`Slide ${s.idx}${failing.has(s.idx) ? ", needs attention" : ""}`} aria-current={idx === s.idx} className={`relative w-[4.6rem] shrink-0 overflow-hidden rounded-lg border-2 bg-white transition lg:w-full ${idx === s.idx ? "border-indigo-600 shadow-md" : "border-transparent opacity-80 hover:opacity-100"}`}>
              <img src={png(s.idx, r.version)} alt="" className="w-full" loading="lazy" />
              {failing.has(s.idx) && <span className="absolute right-1 top-1 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white" aria-hidden />}
              <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 text-[10px] font-medium text-white">{s.idx}</span>
            </button>); })}
        </div>

        {/* preview */}
        <div className="min-w-0">
          <div className="relative">
            <img src={png(idx, row?.version ?? 1)} alt={`Slide ${idx} preview`} className="w-full rounded-2xl border border-[var(--line)] shadow-lg" data-testid="preview" />
            <button aria-label="Previous slide" onClick={() => go(idx - 1)} disabled={idx <= 1} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-md ring-1 ring-black/5 transition hover:bg-white disabled:opacity-0"><ChevronLeft size={18} /></button>
            <button aria-label="Next slide" onClick={() => go(idx + 1)} disabled={idx >= n} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-md ring-1 ring-black/5 transition hover:bg-white disabled:opacity-0"><ChevronRight size={18} /></button>
          </div>
          <p className="mt-2.5 text-center text-xs text-neutral-500">Slide {idx} of {n} · {slide?.archetype} · v{row?.version}{idx === 1 && c.copy.cover ? ` · cover picked from ${c.copy.cover.considered} candidates${c.copy.cover.angle ? ` (${c.copy.cover.angle})` : ""}` : ""} · use ← → to move</p>
        </div>

        {/* side panel */}
        <aside className="card thin-scroll min-w-0 p-4 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto" aria-label="Carousel details">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "checklist", label: <><ListChecks size={15} />Checklist</>, badge: fails ? <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{fails}</span> : undefined },
            { id: "edit", label: <><PencilLine size={15} />Edit</> },
            { id: "captions", label: <><FileText size={15} />Captions</> },
            { id: "cost", label: <><ReceiptText size={15} />Cost</> },
          ]} />
          <div className="mt-4">
            {tab === "checklist" && <Checklist data={cl} loading={clLoading} error={clErr} onSlide={(i) => { setIdx(i); setTab("edit"); }} onRecheck={recheck} rechecking={rechecking} lookbookLabel={d.kit?.brand} />}

            {tab === "edit" && (
              <div className="space-y-5">
                {(c.flags[String(idx)] ?? []).length > 0 && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Needs your attention</p><ul className="mt-1 list-disc pl-5">{c.flags[String(idx)].map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
                <section>
                  <h2 className="text-sm font-semibold">Slide {idx} text <span className="font-normal text-neutral-500">· edits cost ₹0</span></h2>
                  <div className="mt-3 space-y-3">
                    {arch?.slots.map((sl) => { const v = valueOf(sl.name), w = words(v), over = w > sl.max_words || [...v].length > sl.max_chars; return (
                      <div key={sl.name}>
                        <label htmlFor={`slot-${sl.name}`} className="flex items-center justify-between text-xs font-medium text-neutral-600">
                          <span className="flex items-center gap-1.5">{sl.name}<span className="font-normal text-neutral-400">{sl.kind}{sl.optional ? ", optional" : ""}</span>{platformSpecific(sl.name) && <Badge tone="blue">{platform} only</Badge>}</span>
                          <span className={over ? "font-semibold text-rose-600" : "text-neutral-400"}>{w}/{sl.max_words} words · {[...v].length}/{sl.max_chars}</span>
                        </label>
                        <div className="mt-1 flex gap-2">
                          <textarea id={`slot-${sl.name}`} rows={sl.kind === "body" || sl.kind === "list" ? 3 : 1} className={`${input} ${over ? "!border-rose-400" : ""}`} value={v} onChange={(e) => setDrafts((x) => ({ ...x, [sl.name]: e.target.value }))} onBlur={() => saveSlot(sl.name)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && sl.kind !== "list") { e.preventDefault(); (e.target as HTMLElement).blur(); } }} />
                          {drafts[sl.name] !== undefined && <button className={btnPrimary} disabled={saving === sl.name} onMouseDown={(e) => e.preventDefault()} onClick={() => saveSlot(sl.name)}>{saving === sl.name ? <Loader2 size={14} className="animate-spin" /> : "Save"}</button>}
                        </div>
                      </div>); })}
                  </div>
                </section>
                <section className="rounded-xl bg-neutral-50 p-3">
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Wand2 size={15} />Regenerate this slide</h2>
                  <p className="text-xs text-neutral-500">One small AI call. Only this slide changes.</p>
                  <input className={`${input} mt-2`} placeholder='e.g. "make it punchier" or "use a different number"' value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !regen && regenerate()} />
                  <div className="mt-2 flex gap-2">
                    <select className={input} value={archetype} onChange={(e) => setArchetype(e.target.value)} aria-label="Template"><option value="">Keep template ({slide?.archetype})</option>{d.kit?.archetypes.filter((a) => a.id !== slide?.archetype).map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}</select>
                    <button className={btnAccent} disabled={regen} onClick={regenerate}>{regen ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{regen ? "Working…" : "Regenerate"}</button>
                  </div>
                </section>
              </div>
            )}

            {tab === "captions" && (
              <div className="space-y-3">
                <p className="text-xs text-neutral-500">What you'll post with the {platform === "instagram" ? "Instagram" : "LinkedIn"} carousel.</p>
                <pre className="whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 text-sm leading-relaxed">{cap.text}{c.copy.sources_note ? `\n\nSources and assumptions: ${c.copy.sources_note}` : ""}{"\n\n"}{cap.hashtags.join(" ")}</pre>
                {c.copy.sources_note && <p className="text-xs text-neutral-500">The sources line is added to the caption automatically because the look book asks for sources in the caption.</p>}
                <button className={btnGhost} onClick={() => { navigator.clipboard?.writeText(`${cap.text}${c.copy.sources_note ? `\n\nSources and assumptions: ${c.copy.sources_note}` : ""}\n\n${cap.hashtags.join(" ")}`); toast("Caption copied."); }}><Copy size={14} />Copy caption</button>
              </div>
            )}

            {tab === "cost" && (
              <div data-testid="cost-panel">
                <p className="text-2xl font-semibold">{inr(d.cost.carousel.inr)} <span className="text-sm font-normal text-neutral-500">({usd(d.cost.carousel.usd)}) for this carousel</span></p>
                <div className="mt-3 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-neutral-500"><th className="py-1 pr-2">Step</th><th className="pr-2">Model</th><th className="pr-2">Tokens in/out</th><th className="text-right">₹</th></tr></thead><tbody>
                  {d.cost.carousel.rows.map((r: any) => <tr key={r.stage + r.model} className="border-t border-neutral-100"><td className="py-1.5 pr-2">{r.stage.replace("carousel.", "")}{r.calls > 1 ? ` ×${r.calls}` : ""}{r.fallback ? " (fallback)" : ""}</td><td className="pr-2">{r.model.split("/").pop()}</td><td className="pr-2 tabular-nums">{r.in_tokens}/{r.out_tokens}</td><td className="text-right tabular-nums">{inr(r.inr)}</td></tr>)}
                  <tr className="border-t border-neutral-300 font-semibold"><td className="py-1.5" colSpan={3}>This carousel</td><td className="text-right tabular-nums">{inr(d.cost.carousel.inr)}</td></tr>
                  <tr className="text-neutral-500"><td className="py-1.5" colSpan={3}>Look book ingest, one-time</td><td className="text-right tabular-nums">{inr(d.cost.ingest_one_time.inr)}</td></tr>
                  <tr className="text-neutral-500"><td className="py-1.5" colSpan={3}>Ingest amortised over {d.cost.ingest_amortised_over_carousels_so_far.carousels} carousel(s)</td><td className="text-right tabular-nums">{inr(d.cost.ingest_amortised_over_carousels_so_far.inr)}</td></tr>
                </tbody></table></div>
                <p className="mt-3 text-xs text-neutral-500">Inline text edits cost ₹0 and don't appear here. Regenerating a slide adds a small row.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
          <Modal open={delOpen} onClose={() => !deleting && setDelOpen(false)} title="Delete this carousel?">
        <p className="text-sm text-neutral-600">"{c.topic}" and its slides, PDFs, PNGs and captions will be removed. This can't be undone. The look book and other carousels are not affected.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={btnGhost} disabled={deleting} onClick={() => setDelOpen(false)}>Keep it</button>
          <button className={btnDanger} disabled={deleting} onClick={async () => { setDeleting(true); try { await api(`/api/carousels/${id}`, { method: "DELETE" }); toast("Carousel deleted."); router.push(`/brands/${c.brand_id}`); } catch (e: any) { toast(`Could not delete: ${e.message}`, "err"); setDeleting(false); } }}>{deleting ? "Deleting…" : "Delete carousel"}</button>
        </div>
      </Modal>
</Shell>
  );
}
