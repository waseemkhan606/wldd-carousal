import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLookbook } from "@/lib/db/repo";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";

/** The saved template kit as JSON (css, manifest, each template's HTML, build log): for inspecting what the build produced. */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lb = getLookbook(Number((await params).id));
  if (!lb?.kit_path || !fs.existsSync(path.join(lb.kit_path, "manifest.json"))) return err("No template kit", 404);
  const read = (f: string) => { try { return fs.readFileSync(path.join(lb.kit_path!, f), "utf8"); } catch { return null; } };
  const arch: Record<string, string> = {};
  for (const f of fs.readdirSync(path.join(lb.kit_path, "archetypes"))) arch[f.replace(/\.html$/, "")] = read(path.join("archetypes", f)) ?? "";
  return NextResponse.json({ css: read("kit.css"), manifest: JSON.parse(read("manifest.json") ?? "{}"), archetypes: arch, log: read("autoalign.log"), report: JSON.parse(read("report.json") ?? "null") });
}
