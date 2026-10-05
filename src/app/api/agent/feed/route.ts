import { NextRequest, NextResponse } from "next/server";
import { handleAgentRequest } from "@/lib/agent-api";

/** Marcus's agent grants a client one feed tier: the panel's "Feed provider assignment" Grant,
 * with every refusal the panel has (its picker and its Grant button) and no override. Body:
 * {mode, idempotencyKey, user, tierKey}. Nobody is told: the provider still allowlists the
 * client's IP by hand, as with the panel. Auth, idempotency, the daily cap and the operator
 * notes: src/lib/agent-api.ts and docs/agent-api.md. The Vercel WAF admits only claw1 here. */

/** Literal, because Next reads it statically. Must equal AGENT_MAX_DURATION_S (agent-api.test.ts). */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { status, body } = await handleAgentRequest("feed", req);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
