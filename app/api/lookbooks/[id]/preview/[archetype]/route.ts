import { type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLookbook } from "@/lib/db/repo";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string; archetype: string }> }) {
  const { id, archetype } = await params, lb = getLookbook(Number(id));
  if (!lb?.kit_path) return err("No kit yet", 404);
  const f = path.join(lb.kit_path, "previews", `${path.basename(archetype)}.png`);
  if (!fs.existsSync(f)) return err("No preview", 404);
  return new Response(fs.readFileSync(f), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
