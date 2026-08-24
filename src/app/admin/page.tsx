import Link from "next/link";
import { headers } from "next/headers";
import { listClients, maskLicenseKey, LICENSE_TIERS } from "@/lib/licenses";
import { DurationForm } from "@/components/admin/duration-form";
import { ActionButton } from "@/components/admin/action-button";
import {
  issueLicenseAction,
  extendLicenseAction,
  revokeLicenseAction,
  resendWelcomeAction,
  resendGroupInviteAction,
  forceRemoveGroupAction,
} from "./actions";
import { listProviderApplications } from "@/lib/provider-applications";
import { getProviderMarketplaceSummary } from "@/lib/provider-tiers";

// Same route file serves portal.horizonhft.com/admin and feed.horizonhft.com/admin (see
// admin/layout.tsx's host-detection comment) -- this file host-branches at the page level
// rather than adding a second route, per Iris's spec (bus thread
// feed-admin-dashboard-build-2026-08-24 §1). Portal-host content below is unchanged.
const FEED_HOST = "feed.horizonhft.com";

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Feed-admin dashboard (§1-§8 of Iris's spec). Three tiles only -- no "Connections" tile
 * (nothing measures health yet) and no "Register provider" tile (that's a verb, it's the
 * header action below). Pending-applications count is the single shared selector
 * (listProviderApplications({status:"pending"})) per §6's dedup requirement -- do not let
 * the Applications tile compute its own count. Providers tile deliberately omits a
 * paid-subscriber figure: no subscription/payment table references provider_tiers anywhere
 * in this schema (verified against db/migrations/0060-0064), so that number would have to be
 * invented -- Iris's spec explicitly forbids that. Revenue tile headlines retained (not
 * gross) per coxwell's still-open headline-metric question; both are computed in
 * getProviderMarketplaceSummary() so swapping the headline later is a one-line change. */
async function FeedAdminDashboard() {
  const [pendingApplications, marketplace] = await Promise.all([
    listProviderApplications({ status: "pending" }),
    getProviderMarketplaceSummary(),
  ]);
  const pendingCount = pendingApplications.length;
  const marketplaceEmpty = marketplace.liveProviderCount === 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Admin · Overview
          </span>
          <p className="mt-2 text-sm text-zinc-400">
            Feed provider marketplace at a glance — applications, live providers, and
            Horizon-retained revenue.
          </p>
        </div>
        <Link
          href="/admin/provider-applications"
          className="shrink-0 rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
        >
          + Register provider
        </Link>
      </header>

      {pendingCount > 0 ? (
        <div className="mb-6 rounded-lg border border-amber-500/35 bg-amber-950/20 px-4 py-2.5 text-sm text-amber-300">
          {pendingCount} awaiting review
        </div>
      ) : marketplaceEmpty ? (
        <div className="mb-6 rounded-lg border border-emerald-500/35 bg-emerald-950/20 px-4 py-2.5 text-sm text-emerald-300">
          Marketplace is empty — approve an application to bring the first feed online.
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-emerald-500/35 bg-emerald-950/20 px-4 py-2.5 text-sm text-emerald-300">
          All caught up — no applications waiting.
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-amber-400/35 bg-amber-950/20 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Applications</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">{pendingCount}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {pendingCount === 0 ? "No pending applications" : "Awaiting review"}
          </div>
        </div>

        <div className="rounded-xl border border-teal-400/35 bg-teal-950/20 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Providers</div>
          <div className="mt-1 text-2xl font-semibold text-teal-300">{marketplace.liveProviderCount}</div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {marketplace.liveProviderCount === 0
              ? "No live providers yet"
              : `${marketplace.liveTierCount} live tier${marketplace.liveTierCount === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="rounded-xl border border-emerald-400/35 bg-emerald-950/20 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Revenue</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">
            {marketplaceEmpty ? "—" : fmtUsd(marketplace.retainedRunRateCents)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {marketplaceEmpty ? "No revenue yet" : "Horizon-retained run-rate / mo"}
          </div>
        </div>
      </section>

      {!marketplaceEmpty && (
        <section className="mt-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
          <h2 className="text-sm font-medium text-cyan-400">Keep exploring</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Review pending applications or manage live provider terms.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href="/admin/provider-applications" className="text-cyan-400 hover:underline">
              Provider applications
            </Link>
            <Link href="/admin/providers" className="text-cyan-400 hover:underline">
              Providers
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

async function PortalAdminOverview() {
  const clients = await listClients();

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Overview
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Pre-provision licenses, publish installer builds, and manage welcome/invite messaging.
          For filterable per-user and per-license views, see Users and Licenses.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">Pre-provision a license</h2>
        <p className="mt-1 text-xs text-zinc-500">
          For clients who paid before signing up on the portal — bind by email or Telegram user ID;
          they claim it automatically on first login.
        </p>
        <DurationForm
          action={issueLicenseAction}
          submitLabel="Pre-provision"
          successMessage="License pre-provisioned"
          defaultAmount={30}
          defaultUnit="days"
        >
          <div>
            <label className="block text-xs text-zinc-500">Email</label>
            <input
              name="email"
              type="email"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Telegram user ID</label>
            <input
              name="telegramUserId"
              type="number"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Tier</label>
            <select
              name="tier"
              defaultValue="paid"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            >
              {LICENSE_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </DurationForm>
      </section>

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Downloads</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Manage Windows/macOS builds, versions, and history from the{" "}
          <Link href="/admin/downloads" className="text-cyan-400 hover:underline">
            Downloads
          </Link>{" "}
          section.
        </p>
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-blue-400">Clients</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Quick actions across all signups. See Users for search, sort, and pagination.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Email / Telegram</th>
                <th className="pb-2 pr-4">License key</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {clients.map((c) => (
                <tr key={c.userId}>
                  <td className="py-2 pr-4 text-zinc-200">
                    {c.email ?? "—"}
                    {c.telegramUsername ? ` · @${c.telegramUsername}` : ""}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-400">
                    {c.licenseKey ? maskLicenseKey(c.licenseKey) : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={c.paid ? "text-emerald-400" : "text-zinc-500"}>
                      {c.paid ? "Paid" : c.status === "revoked" ? "Revoked" : "Free"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <DurationForm
                        action={issueLicenseAction}
                        hiddenFields={{ userId: c.userId }}
                        submitLabel="Issue"
                        successMessage="License issued"
                        compact
                        triggerLabel="Issue license"
                        disabled={c.paid}
                        disabledReason={
                          c.paid && c.expiresAt
                            ? `User has active license (expires ${new Date(c.expiresAt).toLocaleString()}). Revoke it first to issue a new one.`
                            : undefined
                        }
                      >
                        <div>
                          <label className="block text-[11px] text-zinc-500">Tier</label>
                          <select
                            name="tier"
                            defaultValue="paid"
                            className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200"
                          >
                            {LICENSE_TIERS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      </DurationForm>
                      <DurationForm
                        action={issueLicenseAction}
                        hiddenFields={{ userId: c.userId, tier: "trial" }}
                        submitLabel="Assign"
                        successMessage="Trial assigned"
                        compact
                        triggerLabel="Assign trial"
                        disabled={c.paid}
                        disabledReason={
                          c.paid && c.expiresAt
                            ? `User has active license (expires ${new Date(c.expiresAt).toLocaleString()}). Revoke it first to issue a new one.`
                            : undefined
                        }
                      />
                      {c.licenseId && (
                        <>
                          <DurationForm
                            action={extendLicenseAction}
                            hiddenFields={{ licenseId: c.licenseId, userId: c.userId }}
                            submitLabel="Apply"
                            successMessage="License extended"
                            compact
                            triggerLabel="Extend"
                            showExtendFrom
                            defaultAmount={30}
                            defaultUnit="days"
                            triggerClassName="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                          />
                          <ActionButton
                            action={revokeLicenseAction}
                            hiddenFields={{ licenseId: c.licenseId, userId: c.userId }}
                            label="Revoke"
                            successMessage="License revoked"
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </>
                      )}
                      <ActionButton
                        action={resendWelcomeAction}
                        hiddenFields={{ userId: c.userId }}
                        label="Resend welcome"
                        successMessage="Welcome message sent"
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-blue-500 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {c.paid && (
                        <>
                          <ActionButton
                            action={resendGroupInviteAction}
                            hiddenFields={{ userId: c.userId }}
                            label="Resend invite link"
                            successMessage="Invite link resent"
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <ActionButton
                            action={forceRemoveGroupAction}
                            hiddenFields={{ userId: c.userId }}
                            label="Force remove"
                            successMessage="Removed from group"
                            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-zinc-500">
                    No signups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default async function AdminPage() {
  const host = (await headers()).get("host") || "";
  const isFeedHost = host === FEED_HOST || host.startsWith(`${FEED_HOST}:`);
  return isFeedHost ? <FeedAdminDashboard /> : <PortalAdminOverview />;
}
