import { NextResponse } from "next/server";
export const err = (e: unknown, status = 400) => NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status });

/**
 * Server-sent progress. The job must outlive the browser: closing the tab, reloading or losing wifi mid-ingest must never
 * kill paid work, so a dead client only silences the stream; the job keeps running to completion.
 */
export const sse = (run: (send: (event: string, data: unknown) => void) => Promise<unknown>) => {
  const enc = new TextEncoder();
  let closed = false;
  return new Response(new ReadableStream({
    async start(c) {
      const send = (event: string, data: unknown) => { if (closed) return; try { c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; } };
      try { send("result", await run(send)); } catch (e: any) { send("error", { error: String(e.message ?? e) }); } finally { if (!closed) { closed = true; try { c.close(); } catch { /* client already gone */ } } }
    },
    cancel() { closed = true; },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
};
