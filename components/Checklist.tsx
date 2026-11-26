"use client";
import { useMemo, useState } from "react";
import { BookOpen, Check, ChevronDown, CircleDashed, Code2, Cpu, Info, Loader2, Minus, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge, Ring, Skeleton, btnAccent, btnGhost } from "@/components/ui";

export type Item = { id: string; section: string; page: number; quote: string; statement: string; category: string; scope: string; method: string; by: "code" | "template" | "ai" | "info"; status: "pass" | "fail" | "pending" | "info" | "na"; evidence: string; slides: number[]; fix?: string; stale?: boolean };
export type CL = { items: Item[]; summary: { total: number; pass: number; fail: number; pending: number; info: number; na: number; followed: number; applicable: number }; reviewedAt?: string; stale: boolean };

const CATS: [string, string][] = [["structure", "Structure & slide plan"], ["content", "Content"], ["design", "Design system"], ["voice", "Voice & tone"], ["captions", "Captions"], ["brand", "Brand"]];
const BY = { code: { label: "Checked by code", icon: Code2 }, template: { label: "Built into the template", icon: ShieldCheck }, ai: { label: "AI review", icon: Cpu }, info: { label: "Context", icon: Info } } as const;

function StatusIcon({ s }: { s: Item["status"] }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
  if (s === "pass") return <span className={`${base} bg-emerald-100 text-emerald-700`} aria-label="Followed"><Check size={14} strokeWidth={3} /></span>;
  if (s === "fail") return <span className={`${base} bg-rose-100 text-rose-700`} aria-label="Not followed"><X size={14} strokeWidth={3} /></span>;
  if (s === "pending") return <span className={`${base} bg-amber-100 text-amber-700`} aria-label="Not decided yet"><CircleDashed size={14} /></span>;
  return <span className={`${base} bg-neutral-100 text-neutral-400`} aria-label={s === "na" ? "Not applicable" : "Context"}>{s === "na" ? <Minus size={14} /> : <Info size={13} />}</span>;
}

function Row({ it, onSlide, brandPage }: { it: Item; onSlide: (n: number) => void; brandPage?: boolean }) {
  const [open, setOpen] = useState(false);
  const B = BY[it.by];
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${it.status === "fail" ? "border-rose-200 bg-rose-50/50" : it.status === "pending" ? "border-amber-200 bg-amber-50/40" : "border-transparent hover:bg-neutral-50"}`} data-testid="check-item" data-status={it.status}>
      <div className="flex gap-2.5">
        <StatusIcon s={it.status} />
        <div className="min-w-0 flex-1">
          <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
            <span className={`text-sm font-medium leading-snug ${it.status === "na" || it.status === "info" ? "text-neutral-500" : ""}`}>{it.statement}</span>
            <ChevronDown size={15} className={`mt-0.5 shrink-0 text-neutral-400 transition ${open ? "rotate-180" : ""}`} />
          </button>
          {it.evidence && <p className={`mt-0.5 text-[13px] leading-snug ${it.status === "fail" ? "text-rose-800" : "text-neutral-600"}`}>{it.evidence}{it.stale && <span className="ml-1 text-amber-700"> (before your edits)</span>}</p>}
          {it.fix && it.status === "fail" && <p className="mt-1 text-[13px] text-rose-700"><span className="font-medium">Fix:</span> {it.fix}</p>}
          {it.slides.length > 0 && it.status !== "pass" && it.status !== "na" && !brandPage && (
            <div className="mt-1.5 flex flex-wrap gap-1">{it.slides.map((n) => <button key={n} onClick={() => onSlide(n)} className="rounded-md border border-neutral-300 bg-white px-1.5 py-0.5 text-xs font-medium hover:border-indigo-500 hover:text-indigo-700">Go to slide {n}</button>)}</div>
          )}
          {open && (
            <div className="pop mt-2 rounded-lg bg-white p-2.5 text-xs text-neutral-600 ring-1 ring-neutral-200">
              <p className="flex items-center gap-1.5 font-medium text-neutral-800"><BookOpen size={13} />Look book, page {it.page} · {it.section}</p>
              <p className="mt-1 italic">“{it.quote}”</p>
              <p className="mt-2 flex items-center gap-1.5"><B.icon size={13} />{B.label}</p>
            </div>
          )}
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex"><Badge tone={it.by === "ai" ? "indigo" : it.by === "template" ? "blue" : "gray"} title={B.label}><B.icon size={11} />{it.by === "ai" ? "AI" : it.by === "template" ? "Template" : it.by === "code" ? "Code" : "Info"}</Badge><span className="text-[11px] text-neutral-400">p.{it.page}</span></div>
      </div>
    </li>
  );
}

export default function Checklist({ data, loading, error, onSlide, onRecheck, rechecking, lookbookLabel }: { data: CL | null; loading: boolean; error?: string; onSlide: (n: number) => void; onRecheck: () => void; rechecking: boolean; lookbookLabel?: string }) {
  const [filter, setFilter] = useState<"attention" | "all">("attention");
  const grouped = useMemo(() => {
    if (!data) return [];
    const rank = { fail: 0, pending: 1, pass: 2, info: 3, na: 4 } as const;
    const items = data.items.filter((i) => (filter === "all" ? true : i.status === "fail" || i.status === "pending"));
    return CATS.map(([id, title]) => ({ id, title, items: items.filter((i) => i.category === id).sort((a, b) => rank[a.status] - rank[b.status]) })).filter((g) => g.items.length);
  }, [data, filter]);

  if (error) return <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">Couldn't load the checklist: {error}</p>;
  if (!data) return <div className="space-y-3">{loading && <><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></>}</div>;
  const s = data.summary, pendingAI = data.items.filter((i) => i.by === "ai" && i.status === "pending").length, attention = s.fail + s.pending;
  return (
    <div data-testid="checklist">
      <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-neutral-50 to-white p-3 ring-1 ring-neutral-200">
        <Ring value={s.followed} total={s.applicable} label="guidelines followed" />
        <div className="min-w-0">
          <p className="text-base font-semibold leading-tight">{s.fail === 0 && s.pending === 0 ? "Every guideline is followed" : `${s.followed} of ${s.applicable} guidelines followed`}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{lookbookLabel ?? "From your look book"} · {s.total} guidelines</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="green"><Check size={11} strokeWidth={3} />{s.pass} followed</Badge>
            {s.fail > 0 && <Badge tone="red"><X size={11} strokeWidth={3} />{s.fail} to fix</Badge>}
            {s.pending > 0 && <Badge tone="amber"><CircleDashed size={11} />{s.pending} to decide</Badge>}
            <Badge>{s.info + s.na} context / n/a</Badge>
          </div>
        </div>
      </div>

      {(pendingAI > 0 || data.stale) && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
          <span className="flex items-start gap-2"><Sparkles size={16} className="mt-0.5 shrink-0" />{data.stale ? "You've edited since the last AI review." : `${pendingAI} guideline${pendingAI > 1 ? "s" : ""} (tone, one idea per slide…) need${pendingAI > 1 ? "" : "s"} a model's judgement.`}</span>
          <button className={`${btnAccent} shrink-0 !px-3 !py-1.5`} onClick={onRecheck} disabled={rechecking}>{rechecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{rechecking ? "Checking…" : data.stale ? "Re-check" : "Run AI check"}</button>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="inline-flex rounded-lg bg-neutral-200/60 p-0.5 text-xs font-medium" role="tablist">
          <button role="tab" aria-selected={filter === "attention"} onClick={() => setFilter("attention")} className={`rounded-md px-2.5 py-1 ${filter === "attention" ? "bg-white shadow-sm" : "text-neutral-600"}`}>Needs attention ({attention})</button>
          <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")} className={`rounded-md px-2.5 py-1 ${filter === "all" ? "bg-white shadow-sm" : "text-neutral-600"}`}>All ({s.total})</button>
        </div>
        {data.reviewedAt && <span className="text-[11px] text-neutral-400">AI review {new Date(data.reviewedAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</span>}
      </div>

      {grouped.length === 0 ? (
        <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-center text-sm text-emerald-900"><Check className="mx-auto mb-1" size={22} />Nothing needs attention. Switch to “All” to see every guideline and its evidence.</div>
      ) : grouped.map((g) => (
        <section key={g.id} className="mt-4">
          <h3 className="mb-1 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500"><span>{g.title}</span><span className="tabular-nums">{g.items.filter((i) => i.status === "pass").length}/{g.items.filter((i) => i.status !== "info" && i.status !== "na").length || g.items.length}</span></h3>
          <ul className="space-y-1">{g.items.map((it) => <Row key={it.id} it={it} onSlide={onSlide} />)}</ul>
        </section>
      ))}
      <button className={`${btnGhost} mt-4 w-full`} onClick={onRecheck} disabled={rechecking}>{rechecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Re-run AI check</button>
    </div>
  );
}
