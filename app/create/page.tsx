"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, ListChecks, Sparkles, Wand2 } from "lucide-react";
import Shell from "@/components/Shell";
import { Badge, EmptyState, ProgressPanel, Skeleton, btnAccent, input, useProgress } from "@/components/ui";
import { api, inr, stream, usd } from "@/lib/client";

type Brand = { id: number; name: string; active_lookbook_id: number | null; palette: string[]; guidelines: number };
type Fmt = { id: string; name: string; description: string; kind: string; slides?: number };
type Est = { usd: number; inr: number; model: string; parts: { copy: number; cover: number; repair_allowance: number } };
const LANGS = [["en", "English", "Plain English"], ["hi", "हिंदी", "Devanagari"], ["hinglish", "Hinglish", "Roman script"]] as const;

function CreateForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<number | null>(sp.get("brand") ? Number(sp.get("brand")) : null);
  const [formats, setFormats] = useState<Fmt[]>([]);
  const [singles, setSingles] = useState<Fmt[]>([]);
  const [kind, setKind] = useState<"carousel" | "single">("carousel");
  const [voice, setVoice] = useState("");
  const [format, setFormat] = useState("");
  const [topic, setTopic] = useState("");
  const [n, setN] = useState(5);
  const [lang, setLang] = useState<"en" | "hi" | "hinglish">("en");
  const [est, setEst] = useState<Est | null>(null);
  const [estErr, setEstErr] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const prog = useProgress();

  useEffect(() => { api<{ brands: Brand[] }>("/api/brands").then((r) => { const ok = r.brands.filter((b) => b.active_lookbook_id); setBrands(ok); setBrandId((cur) => cur ?? ok[0]?.id ?? null); }); }, []);
  const brand = brands?.find((b) => b.id === brandId);
  useEffect(() => {
    setFormat(""); setFormats([]); setSingles([]); setKind("carousel"); if (!brand?.active_lookbook_id) return;
    api<any>(`/api/lookbooks/${brand.active_lookbook_id}`).then((d) => { setFormats((d.spec?.formats ?? []).filter((f: Fmt) => f.kind === "carousel")); setSingles((d.spec?.formats ?? []).filter((f: Fmt) => f.kind === "single")); setVoice(d.spec?.voice?.summary ?? ""); }).catch(() => {});
  }, [brand?.active_lookbook_id]);
  useEffect(() => {
    if (!brandId) return; setEstErr("");
    const t = setTimeout(() => api<Est>(`/api/estimate?brandId=${brandId}&n=${n}&language=${lang}&topic=${encodeURIComponent(topic)}${kind === "single" && format ? `&format=${format}` : ""}`).then(setEst).catch((e) => { setEst(null); setEstErr(e.message); }), 200);
    return () => clearTimeout(t);
  }, [brandId, n, lang, topic, kind, format]);

  async function go() {
    setRunning(true); setError(""); prog.reset();
    try { const r = await stream<{ carouselId: number }>("/api/carousels", { brandId, topic, nSlides: kind === "single" ? 1 : n, single: kind === "single", language: lang, format: format || undefined }, prog.push); router.push(`/carousel/${r.carouselId}`); }
    catch (e: any) { setError(e.message); setRunning(false); }
  }

  if (brands && brands.length === 0) return <Shell><EmptyState icon={<Sparkles size={24} />} title="You need a brand first" action={<Link href="/brands" className={btnAccent}>Go to Brands</Link>}>Upload a look book and the studio reads it once. After that you can create carousels that follow it.</EmptyState></Shell>;

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">{kind === "single" ? "Create a post" : "Create a carousel"}</h1>
      <p className="mt-0.5 text-sm text-neutral-500">{kind === "single" ? "One topic becomes a single post for Instagram and LinkedIn, held to your look book." : "One topic becomes an Instagram carousel and a LinkedIn carousel, both held to your look book."}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_21rem]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold"><span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">1</span>Brand</h2>
            {!brands ? <Skeleton className="h-20" /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {brands.map((b) => (
                  <button key={b.id} disabled={running} onClick={() => setBrandId(b.id)} aria-pressed={brandId === b.id} className={`card flex items-center gap-3 p-3 text-left transition ${brandId === b.id ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}>
                    <img src={`/api/lookbooks/${b.active_lookbook_id}/thumb`} alt="" className="h-14 w-11 rounded-md object-cover object-top ring-1 ring-black/10" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{b.name}</span><span className="flex items-center gap-1.5 text-xs text-neutral-500"><ListChecks size={12} />{b.guidelines} guidelines<span className="ml-1 flex gap-0.5">{b.palette.map((h) => <span key={h} className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10" style={{ background: h }} />)}</span></span></span>
                    {brandId === b.id && <Check size={18} className="text-indigo-600" />}
                  </button>
                ))}
              </div>
            )}
          </section>

          {singles.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">What do you want to make?</h2>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                <button role="radio" aria-checked={kind === "carousel"} disabled={running} onClick={() => { setKind("carousel"); setFormat(""); }} className={`card p-2.5 text-left text-sm transition ${kind === "carousel" ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}><span className="font-medium">Carousel</span><span className="block text-xs text-neutral-500">3–10 slides, Instagram + LinkedIn</span></button>
                <button role="radio" aria-checked={kind === "single"} disabled={running} onClick={() => { setKind("single"); setFormat(singles.find((f) => /option|quiz|poll/i.test(`${f.id} ${f.description}`))?.id ?? singles[0].id); }} className={`card p-2.5 text-left text-sm transition ${kind === "single" ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}><span className="font-medium">Single post</span><span className="block text-xs text-neutral-500">{singles.map((f) => f.name).join(" · ")}</span></button>
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold"><span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">2</span>Topic</h2>
            <textarea rows={3} className={input} value={topic} onChange={(e) => setTopic(e.target.value)} disabled={running} placeholder={kind === "single" ? "What should the quiz be about?" : "e.g. 5 money habits to start with your first salary"} aria-label="Topic" />
            {kind === "single" && singles.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-neutral-600">Post format <span className="font-normal text-neutral-400">(from your look book)</span></p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {singles.map((f) => <button key={f.id} disabled={running} aria-pressed={format === f.id} onClick={() => setFormat(f.id)} className={`card p-2.5 text-left text-sm transition ${format === f.id ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}><span className="font-medium">{f.name}</span><span className="block text-xs text-neutral-500">{f.description}</span></button>)}
                </div>
              </div>
            )}
            {kind === "carousel" && formats.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-neutral-600">Format <span className="font-normal text-neutral-400">(from your look book)</span></p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button disabled={running} aria-pressed={format === ""} onClick={() => setFormat("")} className={`card p-2.5 text-left text-sm transition ${format === "" ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}><span className="flex items-center gap-1.5 font-medium"><Wand2 size={14} />Let the AI choose</span><span className="text-xs text-neutral-500">Best fit for the topic</span></button>
                  {formats.map((f) => <button key={f.id} disabled={running} aria-pressed={format === f.id} onClick={() => setFormat(f.id)} className={`card p-2.5 text-left text-sm transition ${format === f.id ? "!border-indigo-500 ring-2 ring-indigo-100" : "card-hover"}`}><span className="font-medium">{f.name}</span><span className="block text-xs text-neutral-500">{f.description}</span></button>)}
                </div>
              </div>
            )}
          </section>

          <section className="grid gap-6 sm:grid-cols-2">
            {kind === "carousel" ? <div>
              <h2 className="mb-2 text-sm font-semibold"><span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">3</span>Slides: <span data-testid="slide-count" className="tabular-nums">{n}</span></h2>
              <input type="range" min={3} max={10} value={n} onChange={(e) => setN(Number(e.target.value))} disabled={running} className="w-full accent-indigo-600" aria-label="Number of slides" />
              <div className="flex justify-between px-0.5 text-[11px] text-neutral-400">{Array.from({ length: 8 }, (_, i) => <span key={i}>{i + 3}</span>)}</div>
            </div> : <div><h2 className="mb-2 text-sm font-semibold"><span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">3</span>One slide</h2><p className="text-xs text-neutral-500">Single posts are one 1080×1350 image for Instagram and LinkedIn.</p></div>}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold"><span className="mr-2 rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white">4</span>Language</legend>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
                {LANGS.map(([k, label, sub]) => <button key={k} role="radio" aria-checked={lang === k} disabled={running} onClick={() => setLang(k)} className={`rounded-lg border px-2 py-1.5 text-center transition ${lang === k ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-neutral-300 bg-white hover:bg-neutral-50"}`}><span className="block text-sm font-medium">{label}</span><span className="block text-[10px] text-neutral-500">{sub}</span></button>)}
              </div>
            </fieldset>
          </section>

          {(running || error) && <ProgressPanel log={prog.log} running={running} error={error || undefined} flow="generate" />}
          <button className={`${btnAccent} w-full !py-3 text-base sm:w-auto sm:!px-8`} disabled={running || !topic.trim() || !brandId} onClick={go}><Sparkles size={18} />{running ? "Generating…" : kind === "single" ? "Generate post" : "Generate carousel"}</button>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-20" data-testid="estimate">
          <div className="card p-4 text-sm">
            <h2 className="font-semibold">Estimated cost</h2>
            {est ? (
              <>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{inr(est.inr)} <span className="text-sm font-normal text-neutral-500">({usd(est.usd)})</span></p>
                <p className="mt-0.5 text-xs text-neutral-500">Both platforms, one {kind === "single" ? "post" : "carousel"}.</p>
                <ul className="mt-3 space-y-1 text-xs text-neutral-600"><li className="flex justify-between"><span>Writing the copy</span><span className="tabular-nums">{inr(est.parts.copy)}</span></li><li className="flex justify-between"><span>Cover director + judge</span><span className="tabular-nums">{inr(est.parts.cover)}</span></li><li className="flex justify-between"><span>Fixes, if needed</span><span className="tabular-nums">{inr(est.parts.repair_allowance)}</span></li></ul>
                <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-500">Editing text on a slide costs ₹0. The actual cost is shown after generating.</p>
              </>
            ) : <p className="mt-2 text-neutral-500">{estErr || "Calculating…"}</p>}
          </div>
          {brand && (
            <div className="card p-4 text-sm">
              <h2 className="flex items-center gap-1.5 font-semibold"><ListChecks size={16} />What will be applied</h2>
              <p className="mt-1 text-xs text-neutral-500">Everything is held to the whole look book, and checked afterwards.</p>
              <ul className="mt-2 space-y-1 text-xs text-neutral-700"><li>• {brand.guidelines} guidelines from the look book</li><li>• {kind === "single" ? "One slide, built on the look book's own template for this format" : "Slide plan: cover hook, one idea per slide, closing fix"}</li><li>• Brand fonts, colours, elements and real logo</li>{voice && <li className="line-clamp-3">• Voice: {voice}</li>}</ul>
              <div className="mt-2"><Badge tone="indigo">Checklist after generating</Badge></div>
            </div>
          )}
        </aside>
      </div>
    </Shell>
  );
}
export default function Create() { return <Suspense><CreateForm /></Suspense>; }
