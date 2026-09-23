import type { TierRequestServerOption, TierRequestState } from "@/components/feeds/tier-request-control";
import { FEED_REGION_TYPE, type FeedRegion } from "./feed-tier-catalogue";
import { listFeedTierRequests } from "./feed-tier-requests";
import type { LicenseDetail } from "./licenses";
import { effectiveServerLocation } from "./server-locations";
import { getServerRegistrationsForUser } from "./server-registration";

/** Everything a TierRequestControl needs about the viewing client, for one region. Hoisted out
 * of /feeds/[region]/tiers on 2026-09-23 when /marketplace/[key] became a second surface that
 * renders the control (m52432). The R6 rules below had one home, and a second copy would be a
 * second place to forget one. The rulings are unchanged and still cited in place. */
export interface TierRequestContext {
  serverOptions: TierRequestServerOption[];
  hasAnyRegisteredServer: boolean;
  requestStateFor: (tierKey: string) => TierRequestState;
  licenseTail: string;
}

export async function getTierRequestContext(
  userId: string,
  activeLicenses: LicenseDetail[],
  region: FeedRegion
): Promise<TierRequestContext> {
  const [userServerRegistrations, existingRequests] = await Promise.all([
    getServerRegistrationsForUser(userId),
    listFeedTierRequests({ userId }),
  ]);
  // Cross-region binding is legitimate (coxwell, leo-cross-region-server-picker-2026-09-04:
  // "yes they can if they wish") -- the request modal picks from every active license the
  // client holds, not just servers registered in the tier's own region. A license with no
  // registration stays listed (Fable's R6 "binding unconfirmed" downstream) -- deliberate,
  // do not filter it out here.
  const registrationByLicenseId = new Map(userServerRegistrations.map((r) => [r.licenseId, r]));
  // Distinct from serverOptions.length === 0 (no active license): this is "active license(s),
  // but not one of them has ever had a server registered" -- R6's "binding unconfirmed" listing
  // only covers a client who has at least one registration elsewhere (marcus,
  // leo-cross-region-server-picker-2026-09-04 ruling). Zero here must still hard-stop.
  const hasAnyRegisteredServer = userServerRegistrations.length > 0;
  const serverOptions: TierRequestServerOption[] = activeLicenses.map((l) => {
    const r = registrationByLicenseId.get(l.id);
    return {
      licenseId: l.id,
      serverName: r?.serverName ?? null,
      declaredIp: r?.declaredIp ?? null,
      region: r ? effectiveServerLocation(r.location, r.serverLocation) : null,
      licenseKeyTail: l.licenseKey.slice(-4),
      registered: !!r,
    };
  });
  // Per-tier request state for this client. The old set collapsed every non-rejected status
  // into one "Requested" pill, so approved and provisioned rows -- a client who already HAS
  // the access -- kept rendering as still-waiting (marcus,
  // leo-approval-invisible-to-client-2026-09-11). Precedence granted > pending: a client can
  // hold a grant and a later request on the same tier (nothing stops a re-request), and the
  // access they already have is the truer thing to show. rejected maps to "none" exactly as
  // before -- it resolves back to a usable Request access button, deliberately.
  const requestStateByTierKey = new Map<string, TierRequestState>();
  for (const r of existingRequests) {
    if (r.region !== region) continue;
    if (r.status === "approved") {
      requestStateByTierKey.set(r.tierKey, "granted");
    } else if (r.status === "pending" && requestStateByTierKey.get(r.tierKey) !== "granted") {
      requestStateByTierKey.set(r.tierKey, "pending");
    }
  }
  const requestStateFor = (tierKey: string): TierRequestState => requestStateByTierKey.get(tierKey) ?? "none";
  // A license key identifies one specific license, not an aggregate — never blend multiple
  // licenses into one tail. Show this region's active license(s); if the client holds two
  // active licenses that both grant this region, show both rather than picking one
  // (coxwell-approved rule, thread multi-license-visibility-2026-08-31).
  const regionFeedType = FEED_REGION_TYPE[region];
  const regionLicenses = regionFeedType
    ? activeLicenses.filter((l) => l.feedTypes.includes(regionFeedType))
    : [];
  const licenseTail =
    regionLicenses.length > 0 ? regionLicenses.map((l) => l.licenseKey.slice(-4)).join(", ") : "—";

  return { serverOptions, hasAnyRegisteredServer, requestStateFor, licenseTail };
}
