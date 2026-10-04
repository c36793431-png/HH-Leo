import { createAccessRequestBatch, DuplicatePendingRequestError, getServerRegistrationForLicense, ServerNotOwnedError } from "./access-requests";
import type { BasketLine } from "./basket-catalogue";
import { listingByKey } from "./marketplace-catalogue";
import { DuplicateTierGrantError, getFeedTierForAssignment } from "./feed-subscriptions";
import { expandTierKey } from "./feed-tier-catalogue";
import { getActiveLicensesForUser } from "./licenses";

/**
 * Basket → provider, v1 (scope m59986, accepted with the server rule in marcus m59987). Admin
 * forwards a basket's FEED lines to the providers' Approvals queue. Nothing new is written: each
 * forward is one createAccessRequestBatch call, the writer the per-tier Request access button
 * uses, so the provider panel, the admin Request access queue and My requests read it unchanged.
 * Strategy and software lines stay admin-only. No schema, so no basket↔envelope link and no
 * per-line state: the writer's own guards (one pending request per server + tier, nothing
 * already live) make a second click write nothing, and the result is shown, not stored.
 * Approval stays where it is today; this only forwards.
 */

export interface ForwardServer {
  id: string;
  serverName: string;
  declaredIp: string;
}

/** The servers a feed line can be forwarded for: each active licence's server row, the same
 * set the client's own Request access modal offers (feeds/actions.ts getActiveLicensesForUser
 * + the licence's server). Ownership is re-checked inside the writer's transaction. */
export async function listForwardServers(userId: string): Promise<ForwardServer[]> {
  const licenses = await getActiveLicensesForUser(userId);
  const rows = await Promise.all(licenses.map((l) => getServerRegistrationForLicense(l.id)));
  return rows.flatMap((r) => (r ? [{ id: r.id, serverName: r.serverName, declaredIp: r.declaredIp }] : []));
}

/** A feed line's member tier keys, from the listing it was basketed as. Null when the listing
 * is gone from the catalogue (the line is a snapshot and can outlive it). */
export function basketLineTierKeys(line: BasketLine): string[] | null {
  if (line.kind !== "feed") return null;
  const listing = listingByKey(line.key);
  if (!listing || listing.category !== "feeds" || listing.tierKeys.length === 0) return null;
  return [...new Set(listing.tierKeys.flatMap(expandTierKey))];
}

export type ForwardOutcome = "forwarded" | "already_pending" | "already_live" | "no_server" | "not_picked" | "failed";

export interface ForwardLineResult {
  key: string;
  name: string;
  outcome: ForwardOutcome;
  /** The server this result is for; null when no server was used. */
  server: string | null;
  /** One plain sentence for the admin. */
  message: string;
}

function serverLabel(s: ForwardServer): string {
  return s.serverName ? `${s.serverName} (${s.declaredIp})` : s.declaredIp;
}

/**
 * Forwards each feed line for its servers. Server rule (m59987): one registered server = use it;
 * several = the admin's picks for that line (`picks`, line key → server ids); none = nothing is
 * written and the line says the client must register a server. One batch per (line, server), so
 * a line's tiers stay one request the way the per-tier button writes a package, and one line
 * refused (already requested, already live) never stops another.
 */
export async function forwardBasketFeedLines(args: {
  userId: string;
  lines: BasketLine[];
  picks: Record<string, string[]>;
}): Promise<ForwardLineResult[]> {
  const feedLines = args.lines.filter((l) => l.kind === "feed");
  if (feedLines.length === 0) return [];
  const servers = await listForwardServers(args.userId);
  const results: ForwardLineResult[] = [];

  for (const line of feedLines) {
    const base = { key: line.key, name: line.name };
    if (servers.length === 0) {
      results.push({ ...base, outcome: "no_server", server: null, message: "Not forwarded: the client must register a server first." });
      continue;
    }
    const tierKeys = basketLineTierKeys(line);
    if (!tierKeys) {
      results.push({ ...base, outcome: "failed", server: null, message: "Not forwarded: this listing is no longer in the catalogue." });
      continue;
    }
    const chosen =
      servers.length === 1 ? servers : servers.filter((s) => (args.picks[line.key] ?? []).includes(s.id));
    if (chosen.length === 0) {
      results.push({ ...base, outcome: "not_picked", server: null, message: "Not forwarded: pick at least one of the client's servers." });
      continue;
    }

    let tiers: Awaited<ReturnType<typeof getFeedTierForAssignment>>[];
    try {
      tiers = await Promise.all(tierKeys.map((k) => getFeedTierForAssignment(k)));
    } catch (err) {
      results.push({ ...base, outcome: "failed", server: null, message: `Not forwarded: ${(err as Error).message}.` });
      continue;
    }
    const noProvider = tiers.filter((t) => !t.providerUserId).map((t) => t.tierName);

    for (const server of chosen) {
      const label = serverLabel(server);
      try {
        await createAccessRequestBatch({
          userId: args.userId,
          items: tiers.map((t) => ({ kind: "feed_tier", serverRegistrationId: server.id, feedTierId: t.feedTierId })),
        });
        const reach =
          noProvider.length === 0
            ? "It is in the provider's Approvals and the admin Request access queue."
            : noProvider.length === tiers.length
              ? "No provider is set on it, so it is in the admin Request access queue only."
              : `It is in the provider's Approvals and the admin Request access queue. No provider on ${noProvider.join(", ")}, so those reach the admin queue only.`;
        const count = tiers.length === 1 ? "" : ` (${tiers.length} tiers)`;
        results.push({ ...base, outcome: "forwarded", server: label, message: `Forwarded for ${label}${count}. ${reach}` });
      } catch (err) {
        if (err instanceof DuplicatePendingRequestError) {
          results.push({ ...base, outcome: "already_pending", server: label, message: `Not forwarded for ${label}: ${err.message}. Nothing was written for this line.` });
        } else if (err instanceof DuplicateTierGrantError) {
          const tier = tiers.find((t) => err.message.startsWith(t.tierName))?.tierName ?? "A tier";
          results.push({ ...base, outcome: "already_live", server: label, message: `Not forwarded for ${label}: ${tier} is already live on this server. Nothing was written for this line.` });
        } else if (err instanceof ServerNotOwnedError) {
          results.push({ ...base, outcome: "failed", server: label, message: `Not forwarded for ${label}: that server is not this client's.` });
        } else {
          results.push({ ...base, outcome: "failed", server: label, message: `Not forwarded for ${label}: ${(err as Error).message}` });
        }
      }
    }
  }
  return results;
}
