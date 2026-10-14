import { NextRequest, NextResponse } from "next/server";
import { handleSignalIngest } from "@/lib/signal-ingest";
import { isHorizonOneHost } from "@/lib/horizonone-host";

/** A signal source registers its daily calls and later sends the prices (Axiom signals dashboard S2b; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 4). Gate, body rules, scoring and the one transaction:
 * src/lib/signal-ingest.ts. Sender contract: docs/signal-ingest.md. proxy.ts's matcher skips /api, so the
 * host check below and the gate in handleSignalIngest are the only gates. */

/** Node, not edge: the gate uses crypto's timingSafeEqual and the write uses the pg pool (fable N3 m67547). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  // horizonone.horizonhft.com only, hard cutover (marcus m68767 Q3). Same 404 and body as the gate's not-production
  // answer (signal-ingest.ts gateSignalIngest), so a caller cannot tell the two apart. No dev bypass: that gate
  // already 404s every VERCEL_ENV but production.
  const wrongHost = !isHorizonOneHost(req.headers.get("host"));
  const { source } = await params;
  // The request goes through unread: the body is read only after the gate passes (fable N3 m67547).
  const { status, body } = wrongHost ? { status: 404, body: { error: "not found" } } : await handleSignalIngest(source, req);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
