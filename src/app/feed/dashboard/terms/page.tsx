import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { TierProposalForm } from "@/components/feed/tier-proposal-form";
import { listApprovedApplicationsForProvider } from "@/lib/provider-applications";
import { listProposalsForApplicationProvider, type ProviderProposalRoundRow } from "@/lib/provider-tier-proposals";
import { formatRelative } from "@/lib/format-time";

const STATUS_BADGE: Record<string, string> = { proposed: "review", confirmed: "active", declined: "lapsed" };
const STATUS_LABEL: Record<string, string> = { proposed: "Awaiting review", confirmed: "Confirmed", declined: "Declined" };

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Slice B (bus thread leo-provider-self-registration-scope-2026-09-10) -- the provider's
 * own write path into provider_tier_proposals, which had none before this. Only meaningful
 * for accounts linked to an approved provider_applications row (source: 'application' or
 * 'admin_manual', doesn't matter -- both get user_id set on approval); a feed_provider
 * account with no such row (e.g. one onboarded purely via the feed_tiers catalogue) sees
 * the empty state below. Submitting writes terms_status = 'proposed' only -- admin's
 * existing review card (confirmProposalRound/declineProposalRound) is unchanged and is
 * still the only path to 'confirmed'/'declined'. */
export default async function FeedTermsPage() {
  const session = await auth();
  const applications = await listApprovedApplicationsForProvider(session!.user!.id!);

  const withProposals = await Promise.all(
    applications.map(async (app) => ({
      app,
      proposals: await listProposalsForApplicationProvider(app.id),
    }))
  );

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Terms</h1>
          <div className="crumb">feed.horizonhft.com / terms</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        {applications.length === 0 ? (
          <div className="card full">
            <div className="empty">
              <div className="eic">◈</div>
              <b>Nothing to submit terms for yet</b>
              <p>
                Terms proposals are tied to an approved provider application. If you were expecting to see one
                here, reach out to Horizon to confirm your application is linked to this account.
              </p>
            </div>
          </div>
        ) : (
          withProposals.map(({ app, proposals }) => (
            <div key={app.id} style={{ marginBottom: 22 }}>
              <div className="card full" style={{ marginBottom: 18 }}>
                <div className="chead">
                  <span className="ic">◈</span>
                  <h3>Propose terms — {app.name}</h3>
                  <span className="cap">reviewed by Horizon before going live</span>
                </div>
                <TierProposalForm
                  applicationId={app.id}
                  tierNameHint={app.tiersOffered}
                  regionsHint={app.regions}
                  coverageHint={app.coverage}
                />
              </div>

              <div className="card full">
                <div className="chead">
                  <span className="ic">▤</span>
                  <h3>Your submitted terms</h3>
                  <span className="cap">{proposals.length} round{proposals.length === 1 ? "" : "s"}</span>
                </div>

                {proposals.length === 0 ? (
                  <div className="empty">
                    <div className="eic">◈</div>
                    <b>Nothing submitted yet</b>
                    <p>Propose terms above — Horizon reviews each round and confirms or returns it.</p>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Tier</th>
                        <th className="r">Client price</th>
                        <th className="r">Your split</th>
                        <th className="r">Trial</th>
                        <th>Status</th>
                        <th className="r">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proposals.map((p: ProviderProposalRoundRow) => (
                        <tr key={p.id}>
                          <td>
                            <b>{p.tierName}</b>
                          </td>
                          <td className="r mono">{money(p.clientPriceCents)} / mo</td>
                          <td className="r mono">{p.providerSplitPct}%</td>
                          <td className="r mono">{p.trialLengthDays}d</td>
                          <td>
                            <span className={`tb ${STATUS_BADGE[p.termsStatus] ?? "draft"}`}>
                              {STATUS_LABEL[p.termsStatus] ?? p.termsStatus}
                            </span>
                          </td>
                          <td className="r">{formatRelative(p.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ))
        )}

        <div className="foot">HORIZON HFT · provider panel · Terms</div>
      </section>
    </>
  );
}
