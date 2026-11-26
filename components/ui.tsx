"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, CircleDashed, Loader2, X } from "lucide-react";
import { type Progress } from "@/lib/client";

export const btn = "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary = `${btn} bg-neutral-900 text-white shadow-sm hover:bg-neutral-700`;
export const btnAccent = `${btn} bg-indigo-600 text-white shadow-sm hover:bg-indigo-500`;
export const btnGhost = `${btn} border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50`;
export const btnDanger = `${btn} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`;
export const input = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-neutral-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export function Badge({ children, tone = "gray", title }: { children: ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" | "indigo"; title?: string }) {
  const t = { gray: "bg-neutral-100 text-neutral-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800", red: "bg-rose-100 text-rose-800", blue: "bg-sky-100 text-sky-800", indigo: "bg-indigo-100 text-indigo-800" }[tone];
  return <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fadein fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`pop card w-full ${wide ? "max-w-2xl" : "max-w-md"} p-5 shadow-2xl`}>
        <div className="mb-3 flex items-start justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="Close" className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100" onClick={onClose}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

/** Ordered pipeline steps so people see what happens, what is done and what is next: never a bare spinner. */
export const STEPS = {
  ingest: [["extract", "Reading the PDF"], ["vision", "Understanding the design"], ["fonts", "Fetching fonts"], ["geometry", "Measuring the sample posts"], ["kit", "Building the templates"], ["fidelity", "Checking fidelity"], ["done", "Ready"]],
  generate: [["copy", "Writing the copy"], ["validate", "Checking the rules"], ["render", "Rendering slides"], ["repair", "Fixing what failed"], ["cover", "Choosing the best cover"], ["export", "Building files"], ["review", "Checking every guideline"], ["done", "Done"]],
} as const;
export const STAGE_LABEL: Record<string, string> = Object.fromEntries([...STEPS.ingest, ...STEPS.generate, ["spec", "Style read"]] as unknown as [string, string][]);

export function ProgressPanel({ log, running, error, flow = "generate" }: { log: Progress[]; running: boolean; error?: string; flow?: "ingest" | "generate" }) {
  const steps = STEPS[flow], seen = new Set(log.map((l) => l.stage)), last = log[log.length - 1];
  const [t0] = useState(() => Date.now()), [now, setNow] = useState(Date.now());
  useEffect(() => { if (!running) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [running]);
  const secs = Math.floor((now - t0) / 1000), curIdx = Math.max(-1, ...log.map((l) => steps.findIndex(([k]) => k === l.stage)));
  return (
    <div className="card p-4 text-sm" aria-live="polite" data-testid="progress">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{error ? <span className="text-rose-700">Something went wrong</span> : running ? "Working…" : "Finished"}</span>
        {running && <span className="tabular-nums text-xs text-neutral-500">{secs}s</span>}
      </div>
      {error && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-3 text-rose-800">Failed: {error}</p>}
      <ol className="mt-3 space-y-1.5">
        {steps.map(([k, label], i) => {
          const done = !error && (i < curIdx || (!running && seen.has(k))) , active = running && !error && i === curIdx;
          return (
            <li key={k} className={`flex items-center gap-2.5 ${done || active ? "text-neutral-900" : "text-neutral-400"}`}>
              <span className="flex h-5 w-5 items-center justify-center">{done ? <Check size={16} className="text-emerald-600" /> : active ? <Loader2 size={16} className="animate-spin text-indigo-600" /> : <CircleDashed size={14} />}</span>
              <span className={active ? "font-medium" : ""}>{label}</span>
              {active && last?.detail && <span className="truncate text-xs text-neutral-500">· {last.detail}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function useProgress() {
  const [log, setLog] = useState<Progress[]>([]);
  return { log, push: (p: Progress) => setLog((l) => [...l, p]), reset: () => setLog([]) };
}

/** Circular score: the headline number of the adherence checklist. */
export function Ring({ value, total, size = 84, label }: { value: number; total: number; size?: number; label?: string }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, f = total ? value / total : 0, tone = f >= 0.95 ? "#059669" : f >= 0.8 ? "#d97706" : "#e11d48";
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${total} ${label ?? ""}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ece9e2" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none"><span className="text-xl font-semibold tabular-nums">{value}<span className="text-sm font-normal text-neutral-400">/{total}</span></span></div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className = "" }: { tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (t: T) => void; className?: string }) {
  return (
    <div role="tablist" className={`thin-scroll flex gap-1 overflow-x-auto rounded-xl bg-neutral-200/60 p-1 ${className}`}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === t.id ? "bg-white shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}>{t.label}{t.badge}</button>
      ))}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) { return <div className={`skeleton ${className}`} />; }

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-neutral-100 p-3 text-neutral-500">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-neutral-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- toasts: a tiny global emitter so any screen can confirm an action ----
type T = { id: number; text: string; tone: "ok" | "err" | "info" };
const listeners = new Set<(t: T) => void>();
let seq = 0;
export const toast = (text: string, tone: T["tone"] = "ok") => listeners.forEach((l) => l({ id: ++seq, text, tone }));
export function ToastHost() {
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef<Record<number, any>>({});
  useEffect(() => {
    const l = (t: T) => { setItems((x) => [...x.slice(-3), t]); timers.current[t.id] = setTimeout(() => setItems((x) => x.filter((y) => y.id !== t.id)), t.tone === "err" ? 7000 : 3500); };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role="status" className={`pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-2.5 text-sm shadow-lg ${t.tone === "err" ? "bg-rose-600 text-white" : t.tone === "info" ? "bg-neutral-800 text-white" : "bg-emerald-600 text-white"}`}>
          {t.tone === "err" ? <CircleAlert size={18} className="mt-0.5 shrink-0" /> : <Check size={18} className="mt-0.5 shrink-0" />}<span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
