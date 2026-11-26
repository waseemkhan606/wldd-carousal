import { type NextRequest } from "next/server";
import { ingestLookbook } from "@/lib/ingest/run";
import { sse } from "@/lib/api";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
/** Runs spec extraction + kit compilation with streamed stage labels. Resumes from a stored spec if one exists. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id), force = req.nextUrl.searchParams.get("force") === "1";
  return sse(async (send) => {
    const r = await ingestLookbook(id, (stage, detail) => send("progress", { stage, detail }), { force });
    return { warnings: r.warnings, costUsd: r.costUsd, fidelity: r.kit?.score ?? null };
  });
}
