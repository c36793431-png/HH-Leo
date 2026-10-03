import { NextResponse } from "next/server";
import { publicEducationCatalogue } from "@/lib/education-public";

/** Public, read-only Academy catalogue for www/education to read at build time (marcus, m59051).
 * No auth: proxy.ts's matcher skips /api. Prerendered at build from the shipped catalogue, so it
 * changes only with a deploy and the CDN serves it. */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(publicEducationCatalogue());
}
