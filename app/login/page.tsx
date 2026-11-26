"use client";
import { useState } from "react";
import { KeyRound, Loader2, Sparkles } from "lucide-react";

export default function Login() {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    if (r.ok) { window.location.href = "/brands"; return; }
    setErr((await r.json().catch(() => ({}))).error ?? "Login failed");
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-7 shadow-xl">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-white"><Sparkles size={22} /></span>
        <h1 className="mt-4 text-2xl font-semibold">Carousel Studio</h1>
        <p className="mt-1 text-sm text-neutral-500">On-brand carousels from your look book, checked against every guideline.</p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="token">Access token</label>
          <div className="relative">
            <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input id="token" type="password" autoComplete="off" autoFocus value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded-lg border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </div>
          {err && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
          <button disabled={busy || !token} className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50">{busy && <Loader2 size={16} className="animate-spin" />}{busy ? "Checking…" : "Enter"}</button>
          <p className="text-xs text-neutral-400">The token was printed once in the server console on first start, or set as APP_ACCESS_TOKEN.</p>
        </form>
      </div>
    </main>
  );
}
