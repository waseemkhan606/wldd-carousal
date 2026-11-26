import { NextResponse, type NextRequest } from "next/server";
import { listBrands, createBrand } from "@/lib/db/repo";
import { db } from "@/lib/db";
import { err } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  const brands = listBrands().map((b) => {
    // palette + guideline count come from the active look book's spec (cheap JSON parse, no rendering)
    const row = b.active_lookbook_id ? (db().prepare("SELECT spec_json FROM lookbooks WHERE id=?").get(b.active_lookbook_id) as { spec_json: string | null } | undefined) : undefined;
    let palette: string[] = [], guidelines = 0, handle = "";
    try { const s = row?.spec_json ? JSON.parse(row.spec_json) : null; palette = (s?.colors ?? []).map((c: any) => c.hex); guidelines = (s?.guidelines ?? []).length; handle = s?.brand?.handle ?? ""; } catch { /* spec unreadable: show the card without them */ }
    return { ...b, palette, guidelines, handle };
  });
  return NextResponse.json({ brands });
}
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  try { return NextResponse.json({ brand: createBrand(String(b.name ?? "")) }); } catch (e) { return err(e, 409); }
}
