import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { getUserReferralStats, REFERRAL_MIN_PAYOUT_USD } from "@/lib/referrals";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { CopyReferralLink } from "@/components/refer/copy-referral-link";

function maskEmail(email: string | null): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user[0] ?? "*"}***@${domain}`;
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function ReferPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [licenseDetail, isAdmin, headerList] = await Promise.all([
    getLicenseForUser(session.user.id).catch(() => null),
    Promise.resolve(isAdminUser(session.user)),
    headers(),
  ]);

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "portal.horizonhft.com";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  const stats = await getUserReferralStats(session.user.id, `${protocol}://${host}`);

  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  const payoutPct = Math.min(100, Math.round((stats.clearedUsd / REFERRAL_MIN_PAYOUT_USD) * 100));

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">◈</span>
            <h3>Your referral link</h3>
            <span className="cap">30% recurring</span>
          </div>
          <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 12 }}>
            Share this link. When someone signs up and becomes a paying customer, you earn 30% of
            every payment they make — for as long as they stay active.
          </p>
          <CopyReferralLink link={stats.referralLink} />
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">▨</span>
            <h3>Stats</h3>
          </div>
          <div className="ref-stats">
            <div className="ref-stat">
              <b>{stats.totalReferred}</b>
              <span>Total referred</span>
            </div>
            <div className="ref-stat">
              <b>{stats.activeReferrals}</b>
              <span>Active referrals</span>
            </div>
            <div className="ref-stat">
              <b>{fmt(stats.totalEarnedUsd)}</b>
              <span>Total earned</span>
            </div>
            <div className="ref-stat">
              <b>{fmt(stats.pendingUsd)}</b>
              <span>Pending</span>
            </div>
            <div className="ref-stat">
              <b>{fmt(stats.clearedUsd)}</b>
              <span>Cleared</span>
            </div>
            <div className="ref-stat">
              <b>{fmt(stats.paidUsd)}</b>
              <span>Paid out</span>
            </div>
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">$</span>
            <h3>Payout</h3>
          </div>
          {stats.clearedUsd >= REFERRAL_MIN_PAYOUT_USD ? (
            <p style={{ color: "var(--hz-ink)", fontSize: 14 }}>
              <b>{fmt(stats.clearedUsd)}</b> cleared and eligible for your next monthly payout.
            </p>
          ) : (
            <>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 8 }}>
                {fmt(stats.clearedUsd)} cleared — {fmt(Math.max(0, REFERRAL_MIN_PAYOUT_USD - stats.clearedUsd))} more
                to reach the ${REFERRAL_MIN_PAYOUT_USD} monthly payout minimum.
              </p>
              <div className="ref-bar">
                <i style={{ width: `${payoutPct}%` }} />
              </div>
            </>
          )}
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">◱</span>
            <h3>Your referrals</h3>
            <span className="cap">{stats.referrals.length} total</span>
          </div>
          {stats.referrals.length === 0 ? (
            <div className="empty">
              <div className="eic">◱</div>
              <b>No referrals yet</b>
              <p>Share your link above to start earning.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="ref-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Signed up</th>
                    <th>Status</th>
                    <th>Lifetime earned</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.referrals.map((r) => (
                    <tr key={r.userId}>
                      <td>{maskEmail(r.email)}</td>
                      <td>{r.referredAt.toISOString().slice(0, 10)}</td>
                      <td>
                        <span className={`ref-status ${r.active ? "active" : "lapsed"}`}>
                          {r.active ? "Active" : "Lapsed"}
                        </span>
                      </td>
                      <td>{fmt(r.lifetimeEarnedUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">↻</span>
            <h3>Earnings log</h3>
            <span className="cap">Newest first</span>
          </div>
          {stats.earnings.length === 0 ? (
            <div className="empty">
              <div className="eic">↻</div>
              <b>No earnings yet</b>
              <p>Earnings show up here as soon as a referral makes a payment.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="ref-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Referral</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.earnings.map((e) => (
                    <tr key={e.id} title={formatAbsoluteUtc(e.earnedAt)}>
                      <td>{e.earnedAt.toISOString().slice(0, 10)}</td>
                      <td>{maskEmail(e.referredEmail)}</td>
                      <td>{fmt(e.amountUsd)}</td>
                      <td>
                        <span className={`ref-status ${e.status}`}>{e.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
