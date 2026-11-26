"use client";
import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Badge, btnGhost, btnPrimary, input } from "@/components/ui";
import { api } from "@/lib/client";

type Settings = {
  keys: { openrouter: string | null; gemini: string | null };
  models: Record<string, { openrouter: string; gemini: string }>;
  pricing: Record<string, { in: number; out: number; cached_in: number; source: string; checked: string }>;
  fx: { usd_inr: number; source: string; checked: string };
};
const TIERS: Record<string, string> = {
  kit_strong: "Building the slide templates from the look book (one-time per brand): the layout-critical step",
  vision_strong: "Look book ingest (one-time per brand): reads the PDF and builds the templates",
  text_strong: "Writing copy, repair, regeneration and cover direction (the per-carousel call)",
  text_cheap: "Light text tasks",
  vision_cheap: "Fidelity checks and picking the best cover",
};

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return <section className="card p-5"><h2 className="font-semibold">{title}</h2>{hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}<div className="mt-3">{children}</div></section>;
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [keyIn, setKeyIn] = useState({ openrouter: "", gemini: "" });
  const [test, setTest] = useState<Record<string, { ok: boolean; text: string } | undefined>>({});
  const [live, setLive] = useState<{ id: string; in: number; out: number }[]>([]);
  const [liveMsg, setLiveMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [current, setCurrent] = useState("");
  const [rot, setRot] = useState<{ ok: boolean; text: string; token?: string } | null>(null);

  const load = () => api<Settings>("/api/settings").then(setS);
  useEffect(() => { load(); }, []);
  const save = async (body: object, ok = "Saved.") => { try { await api("/api/settings", { method: "PUT", json: body }); setMsg(ok); await load(); } catch (e: any) { setMsg(e.message); } };
  const doTest = async (p: "openrouter" | "gemini") => { setTest((t) => ({ ...t, [p]: { ok: false, text: "Testing…" } })); try { const r = await api<{ ok: boolean; error?: string; model?: string }>("/api/settings/test", { method: "POST", json: { provider: p } }); setTest((t) => ({ ...t, [p]: { ok: r.ok, text: r.ok ? `Works (${r.model})` : r.error ?? "Failed" } })); } catch (e: any) { setTest((t) => ({ ...t, [p]: { ok: false, text: e.message } })); } };
  const fetchLive = async () => { setLiveMsg("Fetching…"); try { const r = await api<{ models: { id: string; in: number; out: number }[] }>("/api/settings/models"); setLive(r.models); setLiveMsg(`${r.models.length} models loaded, with live prices.`); } catch (e: any) { setLiveMsg(e.message); } };
  async function rotate(e: React.FormEvent) {
    e.preventDefault(); setRot(null);
    try { const r = await api<{ token: string }>("/api/auth/rotate", { method: "POST", json: { current } }); setRot({ ok: true, text: "Token rotated. Every other session is signed out.", token: r.token }); setCurrent(""); }
    catch (er: any) { setRot({ ok: false, text: er.message }); }
  }
  if (!s) return <Shell><p className="text-neutral-500">Loading…</p></Shell>;
  const edit = (fn: (x: Settings) => void) => setS((p) => { const n = structuredClone(p!); fn(n); return n; });

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">Settings</h1>
      {msg && <p role="status" className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-sm">{msg}</p>}
      <div className="mt-5 space-y-5">
        <Section title="API keys" hint="Stored encrypted on this machine only. Never logged, never sent anywhere except the provider. OpenRouter is tried first; Gemini direct is the fallback.">
          {(["openrouter", "gemini"] as const).map((p) => (
            <div key={p} className="mb-4 last:mb-0">
              <div className="flex items-center gap-2 text-sm font-medium">{p === "openrouter" ? "OpenRouter (primary)" : "Google Gemini (fallback)"}{s.keys[p] ? <Badge tone="green">saved {s.keys[p]}</Badge> : <Badge tone="amber">not set</Badge>}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <input type="password" autoComplete="off" className={`${input} max-w-sm`} placeholder={s.keys[p] ? "Paste a new key to replace" : "Paste key"} value={keyIn[p]} onChange={(e) => setKeyIn((k) => ({ ...k, [p]: e.target.value }))} aria-label={`${p} key`} />
                <button className={btnPrimary} disabled={!keyIn[p].trim()} onClick={async () => { await save({ [`${p}_key`]: keyIn[p] }, "Key saved."); setKeyIn((k) => ({ ...k, [p]: "" })); }}>Save</button>
                <button className={btnGhost} disabled={!s.keys[p]} onClick={() => doTest(p)}>Test</button>
                {s.keys[p] && <button className={btnGhost} onClick={() => save({ [`${p}_key`]: "" }, "Key removed.")}>Remove</button>}
              </div>
              {test[p] && <p className={`mt-1 text-xs ${test[p]!.ok ? "text-emerald-700" : "text-red-700"}`}>{test[p]!.text}</p>}
            </div>
          ))}
        </Section>

        <Section title="Models" hint="One model per tier. OpenRouter ID first; the Gemini-direct ID is used for the fallback.">
          <button className={btnGhost} onClick={fetchLive}>Fetch live list from OpenRouter</button> <span className="text-xs text-neutral-500">{liveMsg}</span>
          <datalist id="or-models">{live.map((m) => <option key={m.id} value={m.id}>{`$${m.in.toFixed(2)} in / $${m.out.toFixed(2)} out per M tokens`}</option>)}</datalist>
          <div className="mt-3 space-y-3">
            {Object.entries(TIERS).map(([tier, desc]) => (
              <div key={tier} className="rounded-lg border border-neutral-200 p-3">
                <p className="text-sm font-medium">{tier} <span className="font-normal text-neutral-500">: {desc}</span></p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input list="or-models" className={input} value={s.models[tier]?.openrouter ?? ""} onChange={(e) => edit((x) => { x.models[tier] = { ...x.models[tier], openrouter: e.target.value }; })} aria-label={`${tier} OpenRouter model`} />
                  <input className={input} value={s.models[tier]?.gemini ?? ""} onChange={(e) => edit((x) => { x.models[tier] = { ...x.models[tier], gemini: e.target.value }; })} aria-label={`${tier} Gemini model`} />
                </div>
              </div>
            ))}
            <button className={btnPrimary} onClick={() => save({ models: s.models }, "Models saved.")}>Save models</button>
          </div>
        </Section>

        <Section title="Pricing table (Gemini direct)" hint="USD per million tokens. OpenRouter calls use the cost OpenRouter reports; this table prices the Gemini fallback.">
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left text-neutral-500"><th className="pr-2">Model</th><th className="pr-2">In</th><th className="pr-2">Out</th><th className="pr-2">Cached in</th><th className="pr-2">Source URL</th><th>Checked</th></tr></thead><tbody>
            {Object.entries(s.pricing).map(([m, p]) => (
              <tr key={m} className="border-t border-neutral-100"><td className="py-1 pr-2 font-medium">{m}</td>
                {(["in", "out", "cached_in"] as const).map((k) => <td key={k} className="pr-2"><input type="number" step="0.001" className={`${input} w-20 py-1`} value={p[k]} onChange={(e) => edit((x) => { x.pricing[m][k] = Number(e.target.value); })} aria-label={`${m} ${k}`} /></td>)}
                <td className="pr-2"><input className={`${input} py-1`} value={p.source} onChange={(e) => edit((x) => { x.pricing[m].source = e.target.value; })} aria-label={`${m} source`} /></td>
                <td><input className={`${input} w-28 py-1`} value={p.checked} onChange={(e) => edit((x) => { x.pricing[m].checked = e.target.value; })} aria-label={`${m} checked`} /></td></tr>
            ))}
          </tbody></table></div>
          <button className={`${btnPrimary} mt-3`} onClick={() => save({ pricing: s.pricing }, "Pricing saved.")}>Save pricing</button>
        </Section>

        <Section title="USD → INR rate" hint="Used to show costs in rupees. Keep the date current.">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-neutral-600">₹ per US$<input type="number" step="0.01" className={`${input} mt-1 w-28`} value={s.fx.usd_inr} onChange={(e) => edit((x) => { x.fx.usd_inr = Number(e.target.value); })} /></label>
            <label className="text-xs font-medium text-neutral-600">Checked on<input className={`${input} mt-1 w-32`} value={s.fx.checked} onChange={(e) => edit((x) => { x.fx.checked = e.target.value; })} /></label>
            <label className="text-xs font-medium text-neutral-600">Source<input className={`${input} mt-1 w-64`} value={s.fx.source} onChange={(e) => edit((x) => { x.fx.source = e.target.value; })} /></label>
            <button className={btnPrimary} onClick={() => save({ fx: s.fx }, "Rate saved.")}>Save rate</button>
          </div>
        </Section>

        <Section title="Access token" hint="One shared token gates the whole app. Rotating needs the current token, shows the new one once, and signs out every other session.">
          <form onSubmit={rotate} className="flex flex-wrap gap-2"><input type="password" className={`${input} max-w-sm`} placeholder="Current token" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current token" /><button className={btnPrimary} disabled={!current}>Rotate token</button></form>
          {rot && <p role="status" className={`mt-2 text-sm ${rot.ok ? "text-emerald-700" : "text-red-700"}`}>{rot.text}</p>}
          {rot?.token && <p className="mt-2 break-all rounded-md bg-yellow-100 p-3 font-mono text-sm">New token (shown once): {rot.token}</p>}
        </Section>
      </div>
    </Shell>
  );
}
