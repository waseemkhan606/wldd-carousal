import { NextResponse } from "next/server";
import { listOpenrouterModels } from "@/lib/llm/openrouter";
export const dynamic = "force-dynamic";
/** Live OpenRouter model list with per-million-token prices, for the model pickers in Settings. */
export async function GET() {
  try { return NextResponse.json({ models: (await listOpenrouterModels()).filter((m) => !m.id.includes(":batch")).sort((a, b) => a.id.localeCompare(b.id)) }); }
  catch (e: any) { return NextResponse.json({ error: `Could not reach OpenRouter: ${e.message}` }, { status: 502 }); }
}
