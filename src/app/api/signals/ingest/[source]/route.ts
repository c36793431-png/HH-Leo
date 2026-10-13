import { NextRequest, NextResponse } from "next/server";
import { handleSignalIngest } from "@/lib/signal-ingest";

/** A signal source registers its daily calls and later sends the prices (Axiom signals dashboard S2b; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 4). Gate, body rules, scoring and the one transaction:
 * src/lib/signal-ingest.ts. Sender contract: docs/signal-ingest.md. proxy.ts's matcher skips /api, so the
 * gate in handleSignalIngest is the only gate. */

/** Node, not edge: the gate uses crypto's timingSafeEqual and the write uses the pg pool (fable N3 m67547). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  // The request goes through unread: the body is read only after the gate passes (fable N3 m67547).
  const { status, body } = await handleSignalIngest(source, req);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
