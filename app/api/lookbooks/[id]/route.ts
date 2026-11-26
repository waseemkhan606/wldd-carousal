import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getLookbook, setActive, deleteLookbook } from "@/lib/db/repo";
import { lookbookCost } from "@/lib/llm/usage";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const readJson = (f: string) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

export async function GET(_: NextRequest, { params }: P) {
  const lb = getLookbook(Number((await params).id));
  if (!lb) return err("Look book not found", 404);
  const report = lb.kit_path ? readJson(path.join(lb.kit_path, "report.json")) : null;
  const manifest = lb.kit_path ? readJson(path.join(lb.kit_path, "manifest.json")) : null;
  return NextResponse.json({
    lookbook: { id: lb.id, brand_id: lb.brand_id, version: lb.version, is_active: !!lb.is_active, status: lb.status, fidelity_score: lb.fidelity_score, spec_user_edited: !!lb.spec_user_edited, has_kit: !!manifest },
    spec: lb.spec_json ? JSON.parse(lb.spec_json) : null,
    report: report && { score: report.score, min: report.min, warnings: report.warnings, perArchetype: Object.fromEntries(Object.entries(report.perArchetype ?? {}).map(([k, v]: any) => [k, { score: v.score, judge: v.judge }])) },
    archetypes: manifest?.archetypes?.map((a: any) => ({ id: a.id, slots: a.slots })) ?? [],
    cost: lookbookCost(lb.id),
  });
}
export async function PATCH(req: NextRequest, { params }: P) {
  const id = Number((await params).id), b = await req.json().catch(() => ({}));
  try { if (b.active) setActive(id); return NextResponse.json({ ok: true }); } catch (e) { return err(e); }
}
export async function DELETE(_: NextRequest, { params }: P) { try { deleteLookbook(Number((await params).id)); return NextResponse.json({ ok: true }); } catch (e) { return err(e, 409); } }
