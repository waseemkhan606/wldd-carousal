"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, ListChecks, Plus, Sparkles, Trash2, UploadCloud } from "lucide-react";
import Shell from "@/components/Shell";
import { Badge, EmptyState, Modal, ProgressPanel, Skeleton, btnDanger, btnGhost, btnPrimary, input, toast, useProgress } from "@/components/ui";
import { api, stream } from "@/lib/client";

type BrandRow = { id: number; name: string; slug: string; handle: string; active_lookbook_id: number | null; fidelity_score: number | null; carousels: number; palette: string[]; guidelines: number };

export default function Brands() {
  const router = useRouter();
  const [brands, setBrands] = useState<BrandRow[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [toDelete, setToDelete] = useState<BrandRow | null>(null);
  const prog = useProgress();

  const load = () => api<{ brands: BrandRow[] }>("/api/brands").then((r) => setBrands(r.brands)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setFailed(""); prog.reset();
    let brandId: number | null = null;
    try {
      const { brand } = await api<{ brand: { id: number } }>("/api/brands", { method: "POST", json: { name } });
      brandId = brand.id;
      const fd = new FormData(); fd.append("file", file!);
      const { lookbook } = await api<{ lookbook: { id: number } }>(`/api/brands/${brand.id}/lookbooks`, { method: "POST", body: fd });
      prog.push({ stage: "extract" });
      await stream(`/api/lookbooks/${lookbook.id}/ingest`, {}, prog.push);
      toast(`${name} is ready.`);
      router.push(`/brands/${brand.id}`);
    } catch (e: any) {
      setFailed(e.message);
      if (brandId) { toast("Ingest didn't finish. Your PDF is saved: retry from the brand page.", "err"); router.push(`/brands/${brandId}`); }
      setBusy(false);
    }
  }
  async function remove() {
    if (!toDelete) return;
    await api(`/api/brands/${toDelete.id}`, { method: "DELETE" });
    toast(`${toDelete.name} deleted.`, "info"); setToDelete(null); load();
  }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f?.type === "application/pdf") setFile(f); else toast("That isn't a PDF.", "err"); };

  return (
    <Shell>
      <div className="flex items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Brand library</h1><p className="mt-0.5 text-sm text-neutral-500">Upload a look book once. Every carousel after that follows it.</p></div>
        <button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} />New brand</button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
      {!brands && !error && <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>}
      {brands && brands.length === 0 && (
        <div className="mt-8"><EmptyState icon={<UploadCloud size={24} />} title="No brands yet" action={<button className={btnPrimary} onClick={() => setCreating(true)}><Plus size={16} />Upload your first look book</button>}>The look book PDF is read once: its colours, fonts, templates and every rule become a checklist that each carousel is held to.</EmptyState></div>
      )}
      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {brands?.map((b) => (
          <div key={b.id} className="card card-hover overflow-hidden" data-testid="brand-card">
            <Link href={`/brands/${b.id}`} className="block">
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-neutral-100">
                {b.active_lookbook_id ? <img src={`/api/lookbooks/${b.active_lookbook_id}/thumb`} alt="" className="h-full w-full object-cover object-top" /> : <div className="flex h-full items-center justify-center text-sm text-neutral-400">No look book yet</div>}
                {b.palette.length > 0 && <div className="absolute inset-x-0 bottom-0 flex h-2">{b.palette.map((h) => <span key={h} className="flex-1" style={{ background: h }} />)}</div>}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-base font-semibold">{b.name}</h2>{b.handle && <p className="truncate text-xs text-neutral-500">@{b.handle.replace(/^@/, "")}</p>}</div>{b.fidelity_score != null && <Badge tone={b.fidelity_score >= 80 ? "green" : b.fidelity_score >= 65 ? "amber" : "red"} title="How closely the templates match your look book's own sample posts">fidelity {b.fidelity_score}</Badge>}</div>
                <div className="mt-3 flex items-center gap-3 text-xs text-neutral-600">
                  <span className="flex items-center gap-1"><ListChecks size={13} />{b.guidelines ? `${b.guidelines} guidelines` : "guidelines pending"}</span>
                  <span>·</span><span>{b.carousels} carousel{b.carousels === 1 ? "" : "s"}</span>
                  <span className="ml-auto flex gap-1">{b.palette.map((h) => <span key={h} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ background: h }} title={h} />)}</span>
                </div>
              </div>
            </Link>
            <div className="flex gap-2 border-t border-[var(--line)] p-3">
              <Link href={`/create?brand=${b.id}`} className={`${btnPrimary} flex-1`}><Sparkles size={15} />Create carousel</Link>
              <button className={`${btnDanger} !px-2.5`} onClick={() => setToDelete(b)} aria-label={`Delete ${b.name}`}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={creating} onClose={() => !busy && setCreating(false)} title="New brand" wide>
        {busy ? <ProgressPanel log={prog.log} running error={failed || undefined} flow="ingest" /> : (
          <div className="space-y-4">
            <label className="block text-sm font-medium">Brand name<input className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your brand name" autoFocus /></label>
            <div>
              <p className="text-sm font-medium">Look book PDF</p>
              <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} className={`mt-1 flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${drag ? "border-indigo-500 bg-indigo-50" : file ? "border-emerald-400 bg-emerald-50" : "border-neutral-300 hover:border-neutral-400"}`}>
                <FileUp size={26} className={file ? "text-emerald-600" : "text-neutral-400"} />
                <span className="text-sm font-medium">{file ? file.name : "Drop the PDF here, or click to choose"}</span>
                <span className="text-xs text-neutral-500">{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "Up to 60 MB"}</span>
                <input type="file" accept="application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">The look book is read once: its structure is parsed exactly, the design is understood by a vision model (a one-time cost, shown afterwards), and templates are built and tested against your PDF. It takes a few minutes.</p>
            {failed && <p role="alert" className="text-sm text-rose-700">{failed}</p>}
            <div className="flex justify-end gap-2"><button className={btnGhost} onClick={() => setCreating(false)}>Cancel</button><button className={btnPrimary} disabled={!name.trim() || !file} onClick={create}>Create and read look book</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete ${toDelete?.name}?`}>
        <p className="text-sm text-neutral-600">This permanently deletes the brand, all its look book versions, templates and carousels, including files on disk. It can't be undone.</p>
        <div className="mt-4 flex justify-end gap-2"><button className={btnGhost} onClick={() => setToDelete(null)}>Cancel</button><button className={btnDanger} onClick={remove}><Trash2 size={15} />Delete permanently</button></div>
      </Modal>
    </Shell>
  );
}
