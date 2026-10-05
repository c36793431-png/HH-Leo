import { NextRequest, NextResponse } from "next/server";
import { handleAgentRequest } from "@/lib/agent-api";

/** Marcus's agent grants a client a trial licence: the panel's "Issue new license", tier trial,
 * with every refusal the panel has and no override. Body: {mode, idempotencyKey, user, days,
 * feeds}. Auth, idempotency, the daily cap and the operator notes: src/lib/agent-api.ts and
 * docs/agent-api.md. The Vercel WAF admits only claw1 here. */

/** Literal, because Next reads it statically. Must equal AGENT_MAX_DURATION_S (agent-api.test.ts). */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { status, body } = await handleAgentRequest("trial", req);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
