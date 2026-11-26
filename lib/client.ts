"use client";
export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("Signed out"); }
  const text = await r.text();
  let j: any = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j as T;
}

export type Progress = { stage: string; detail?: string };

/** POST and read a server-sent-event stream: progress events, then one result (or error) event. */
export async function stream<T = any>(url: string, body: unknown, onProgress: (p: Progress) => void): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (r.status === 401) { window.location.href = "/login"; throw new Error("Signed out"); }
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `Request failed (${r.status})`); }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", result: T | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1], data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      const j = JSON.parse(data);
      if (ev === "progress") onProgress(j);
      else if (ev === "error") throw new Error(j.error);
      else if (ev === "result") result = j;
    }
  }
  if (result === undefined) { const e = new Error("The connection dropped before the result arrived. The job keeps running on the server."); e.name = "StreamDropped"; throw e; }
  return result;
}

export const inr = (n: number) => `₹${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 1)}`;
export const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;
