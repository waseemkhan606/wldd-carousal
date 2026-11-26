import { NextResponse, type NextRequest } from "next/server";
export const dynamic = "force-dynamic";
type Fam = { family: string; category: string; subsets: string[] };
let cache: Fam[] | null = null;
async function families(): Promise<Fam[]> {
  if (cache) return cache;
  try {
    const t = await (await fetch("https://fonts.google.com/metadata/fonts", { signal: AbortSignal.timeout(15000) })).text();
    const j = JSON.parse(t.replace(/^\)\]\}'\s*/, ""));
    cache = (j.familyMetadataList as any[]).map((f) => ({ family: f.family, category: f.category, subsets: f.subsets }));
  } catch { cache = []; }
  return cache;
}
/** Google Fonts search for the style review. ?q=text&devanagari=1 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").toLowerCase(), deva = req.nextUrl.searchParams.get("devanagari") === "1";
  const list = (await families()).filter((f) => (!deva || f.subsets.includes("devanagari")) && f.family.toLowerCase().includes(q)).slice(0, 40);
  return NextResponse.json({ fonts: list, offline: cache?.length === 0 });
}
