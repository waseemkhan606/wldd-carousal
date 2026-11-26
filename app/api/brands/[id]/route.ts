import { NextResponse, type NextRequest } from "next/server";
import { getBrand, deleteBrand, listLookbooks } from "@/lib/db/repo";
import { db } from "@/lib/db";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export async function GET(_: NextRequest, { params }: P) {
  const id = Number((await params).id), brand = getBrand(id);
  if (!brand) return err("Brand not found", 404);
  const lookbooks = listLookbooks(id).map((l) => ({ id: l.id, version: l.version, is_active: !!l.is_active, status: l.status, fidelity_score: l.fidelity_score, ingest_cost: l.ingest_cost_json ? JSON.parse(l.ingest_cost_json) : null, spec_user_edited: !!l.spec_user_edited, created_at: l.created_at }));
  const carousels = db().prepare("SELECT id,topic,n_slides,language,status,created_at FROM carousels WHERE brand_id=? ORDER BY id DESC LIMIT 50").all(id);
  return NextResponse.json({ brand, lookbooks, carousels });
}
export async function DELETE(_: NextRequest, { params }: P) { deleteBrand(Number((await params).id)); return NextResponse.json({ ok: true }); }
