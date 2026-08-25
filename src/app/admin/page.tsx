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
import { listProviderApplications, getProviderApplicationStats } from "@/lib/provider-applications";
import { getProviderMarketplaceSummary } from "@/lib/provider-tiers";
import { getTermsQueueStats } from "@/lib/provider-terms-queue";
import { formatRelative, wholeDaysSince } from "@/lib/format-time";

// Same route file serves portal.horizonhft.com/admin and feed.horizonhft.com/admin (see
// admin/layout.tsx's host-detection comment) -- this file host-branches at the page level
// rather than adding a second route, per Iris's spec (bus thread
// feed-admin-dashboard-build-2026-08-24 §1). Portal-host content below is unchanged.
const FEED_HOST = "feed.horizonhft.com";

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Feed-admin dashboard (§1-§8 of Iris's spec), re-skinned against
 * design-refs/feed-provider/feed-admin-dashboard-live-desktop.png and the class grammar in
 * feed-admin-dashboard.html (§8 says lift them; translated to this codebase's Tailwind idiom
 * rather than importing her raw CSS, so the shell stays one system).
 *
 * The structure here was already right and is unchanged: three tiles, no Connections tile
 * (nothing measures connection health yet -- §3's tile-vs-tab rule: a tab may exist unwired,
 * a tile asserts a fact and may not), and no Register-provider tile (a verb, not a data
 * surface -- it's the header action). What this pass adds is the visual layer the renders
 * specify: the attention band's second clause + deep-link, the "At a glance" kicker, full
 * tile anatomy (icon / status tag / headline / sub-metrics / deep-link foot), and the lower
 * deep-read row (Recent activity + Revenue split).
 *
 * Data honesty (§3, §5): every figure below reads a real column. The mockup's Providers tile
 * shows "18 tiers · 142 paid subscriptions" -- the subscription half is NOT rendered here,
 * because no subscription or payment table references provider_tiers in this schema, so that
 * number would have to be invented and §3 explicitly forbids inventing one. Recent activity is
 * derived from appliedAt/reviewedAt on real application rows, not from a synthetic event log.
 *
 * Pending count stays the single shared selector per §6 -- the sidebar badge and the
 * Applications tile must not be able to disagree, so neither recomputes it. */
async function FeedAdminDashboard() {
  const [applicationStats, pendingApplications, allApplications, marketplace, termsQueueStats] = await Promise.all([
    getProviderApplicationStats(),
    listProviderApplications({ status: "pending" }),
    listProviderApplications({}),
    getProviderMarketplaceSummary(),
    getTermsQueueStats(),
  ]);

  // §6: same selector the sidebar badge reads (admin/layout.tsx) -- this tile must not
  // recompute its own count from pendingApplications.length, which is a separate query.
  const pendingCount = applicationStats.pendingCount;
  const marketplaceEmpty = marketplace.liveProviderCount === 0;
  const needsReviewCount = termsQueueStats.needsTermsReviewCount;
  const payoutRunRateCents = marketplace.grossRunRateCents - marketplace.retainedRunRateCents;
  const liveRevenue = marketplace.grossRunRateCents > 0;

  const oldestPendingDays = pendingCount
    ? wholeDaysSince(
        new Date(Math.min(...pendingApplications.map((a) => a.appliedAt.getTime())))
      )
    : 0;

  // Real rows only -- an application produces an "applied" event, and a decided one also
  // produces a "reviewed" event. No invented activity types (§3).
  const activity = allApplications
    .flatMap((a) => {
      const events: { at: Date; title: string; detail: string; kind: "applied" | "approved" | "declined" }[] = [
        {
          at: a.appliedAt,
          title: `New application — ${a.name}`,
          detail: `${a.email} applied to provide a feed`,
          kind: "applied",
        },
      ];
      if (a.reviewedAt && a.status !== "pending") {
        events.push({
          at: a.reviewedAt,
          title: `Application ${a.status} — ${a.name}`,
          detail: a.reviewedBy ? `reviewed by ${a.reviewedBy}` : "reviewed",
          kind: a.status === "approved" ? "approved" : "declined",
        });
      }
      return events;
    })
    .sort((x, y) => y.at.getTime() - x.at.getTime())
    .slice(0, 4);

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
          href="/admin/register-provider"
          className="shrink-0 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 px-3.5 py-2 text-xs font-semibold text-teal-950 shadow-lg shadow-teal-500/20 hover:from-teal-300 hover:to-teal-500"
        >
          + Register provider
        </Link>
      </header>

      {/* Attention band (§5) -- amber only when something needs a human, calm emerald otherwise. */}
      {pendingCount > 0 ? (
        <div className="mb-6 flex items-center gap-3.5 rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-400/10 to-amber-400/[0.02] px-4 py-3.5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-base">
            ⚑
          </span>
          <p className="text-[13.5px] text-zinc-200">
            <b className="font-semibold text-amber-300">
              {pendingCount} application{pendingCount === 1 ? "" : "s"}
            </b>{" "}
            awaiting review{" "}
            <span className="text-zinc-500">
              · oldest is{" "}
              <b className="font-semibold text-amber-300">
                {oldestPendingDays} day{oldestPendingDays === 1 ? "" : "s"}
              </b>{" "}
              old
            </span>
          </p>
          <Link
            href="/admin/provider-applications"
            className="ml-auto whitespace-nowrap text-[13px] font-semibold text-amber-300 hover:text-amber-200"
          >
            Review queue →
          </Link>
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-3.5 rounded-2xl border border-emerald-400/25 bg-gradient-to-r from-emerald-400/[0.07] to-emerald-400/[0.01] px-4 py-3.5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-emerald-400/12 text-base">
            ✓
          </span>
          <p className="text-[13.5px] text-zinc-200">
            {marketplaceEmpty ? (
              <>
                <b className="font-semibold text-emerald-300">Marketplace is empty</b> — approve an
                application to bring the first feed online.
              </>
            ) : (
              <>
                <b className="font-semibold text-emerald-300">All caught up</b> — no applications
                waiting.
              </>
            )}
          </p>
        </div>
      )}

      {/* "At a glance" kicker (§4 -- teal-400 is the feed-host identity accent). */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="text-[15px] font-bold uppercase tracking-[0.08em] text-teal-400">
          <span className="opacity-70">◇ </span>At a glance
        </span>
        <span className="h-px flex-1 bg-zinc-800" />
        <span className="text-[11px] text-zinc-600">each tile summarises a tab &amp; opens it</span>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* 1 · Applications -- the thing that needs a human. */}
        <Link
          href="/admin/provider-applications"
          className="group flex min-h-[172px] flex-col rounded-2xl border border-zinc-800 border-l-2 border-l-amber-400/50 bg-zinc-900/40 p-[18px] pb-[15px] transition hover:-translate-y-0.5 hover:border-teal-400"
        >
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-500/10 text-xs text-zinc-400">
              ▤
            </span>
            <span className="text-xs font-semibold text-zinc-300">Provider applications</span>
            {pendingCount > 0 && (
              <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.09em] text-amber-300">
                {pendingCount} pending
              </span>
            )}
          </div>
          <div className="mt-3.5 text-[44px] font-extrabold leading-none text-zinc-100">
            {pendingCount}
          </div>
          <div className="mt-2 min-h-[16px] text-xs text-zinc-500">
            {pendingCount === 0
              ? "no applications yet — the public apply form feeds this queue"
              : `awaiting review · oldest is ${oldestPendingDays} day${oldestPendingDays === 1 ? "" : "s"} old`}
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-3.5 text-[12.5px] font-semibold text-teal-400">
            Review queue <span className="transition group-hover:translate-x-[3px]">→</span>
          </div>
        </Link>

        {/* 2 · Providers -- live count + tiers. Real columns only; no invented health rollup.
            Status tag keys off liveProviderCount alone (§6 fix) -- 0 live is a cold-start
            fact, not the absence of a "needs review" fact, so the two render as independent
            signals rather than one suppressing the other. Not a Link (unlike the other two
            tiles) because it carries two distinct deep-links -- the terms-review sub-metric
            and the footer -- and nested <a> isn't valid HTML. */}
        <div className="group flex min-h-[172px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-[18px] pb-[15px] transition hover:-translate-y-0.5 hover:border-teal-400">
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-500/10 text-xs text-zinc-400">
              ◈
            </span>
            <span className="text-xs font-semibold text-zinc-300">Providers</span>
            {marketplace.liveProviderCount > 0 ? (
              <span className="ml-auto rounded-full bg-emerald-400/12 px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.09em] text-emerald-300">
                Live
              </span>
            ) : (
              <span className="ml-auto rounded-full bg-zinc-500/10 px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.09em] text-zinc-400">
                Cold start
              </span>
            )}
          </div>
          <div className="mt-3.5 text-[44px] font-extrabold leading-none text-zinc-100">
            {marketplace.liveProviderCount}
            <small className="ml-1.5 font-mono text-sm font-medium text-zinc-600">live</small>
          </div>
          <div className="mt-2 min-h-[16px] text-xs text-zinc-500">
            {marketplaceEmpty
              ? "No providers yet — approve an application to add your first feed provider"
              : `${marketplace.liveTierCount} live tier${marketplace.liveTierCount === 1 ? "" : "s"}`}
          </div>
          {needsReviewCount > 0 && (
            <Link
              href="/admin/providers?filter=needs-review"
              className="mt-1.5 text-[11px] font-semibold text-amber-300 hover:text-amber-200"
            >
              {needsReviewCount} terms review →
            </Link>
          )}
          <Link
            href="/admin/providers"
            className="mt-auto flex items-center gap-1.5 pt-3.5 text-[12.5px] font-semibold text-teal-400"
          >
            All providers <span className="transition group-hover:translate-x-[3px]">→</span>
          </Link>
        </div>

        {/* 3 · Revenue -- emerald is money only (§4). Headline is retained; §9 keeps the
            gross-vs-retained swap a one-liner while coxwell's call is still open. */}
        <Link
          href="/admin/revenue"
          className="group flex min-h-[172px] flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 p-[18px] pb-[15px] transition hover:-translate-y-0.5 hover:border-teal-400"
        >
          <div className="mb-0.5 flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-500/10 text-xs text-zinc-400">
              ▦
            </span>
            <span className="text-xs font-semibold text-zinc-300">Horizon retained</span>
            <span className="ml-auto rounded-full bg-zinc-500/10 px-2 py-[3px] text-[9px] font-bold uppercase tracking-[0.09em] text-zinc-400">
              Run-rate
            </span>
          </div>
          <div className="mt-3.5 text-[44px] font-extrabold leading-none text-emerald-400">
            {marketplaceEmpty ? "$0" : fmtUsd(marketplace.retainedRunRateCents)}
            {!marketplaceEmpty && (
              <small className="ml-1.5 font-mono text-sm font-medium text-zinc-600">/mo</small>
            )}
          </div>
          <div className="mt-2 min-h-[16px] text-xs text-zinc-500">
            {marketplaceEmpty
              ? "$0 — appears after the first paid subscription"
              : `Gross ${fmtUsd(marketplace.grossRunRateCents)} · providers paid ${fmtUsd(payoutRunRateCents)}`}
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-3.5 text-[12.5px] font-semibold text-teal-400">
            Revenue &amp; splits <span className="transition group-hover:translate-x-[3px]">→</span>
          </div>
        </Link>
      </section>

      {/* Lower deep-read row (§3 hierarchy). §5's hide rule is per-card, not per-row (Iris's
          ruling, 2026-08-25) -- each card evaluates its own emptiness (activity.length === 0,
          liveRevenue === 0) independently, so e.g. activity can show while revenue stays
          hidden pre-first-subscription. */}
      <>
          {activity.length > 0 && (
            <section className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Recent activity</h2>
                <Link
                  href="/admin/provider-applications?status=all"
                  className="text-xs font-semibold text-teal-400 hover:text-teal-300"
                >
                  All applications →
                </Link>
              </div>
              <ul className="mt-4 divide-y divide-zinc-800/70">
                {activity.map((e, i) => (
                  <li key={i} className="flex items-start gap-3 py-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs ${
                        e.kind === "approved"
                          ? "bg-emerald-400/12 text-emerald-300"
                          : e.kind === "declined"
                            ? "bg-rose-400/12 text-rose-300"
                            : "bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      {e.kind === "approved" ? "✔" : e.kind === "declined" ? "✕" : "▤"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-200">{e.title}</div>
                      <div className="truncate text-xs text-zinc-500">{e.detail}</div>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-600">{formatRelative(e.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {liveRevenue && (
            <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Revenue split</h2>
                <span className="font-mono text-[11px] text-zinc-600">run-rate · admin 100% view</span>
              </div>
              <p className="mt-3 text-sm text-zinc-300">
                Providers payout{" "}
                <b className="font-semibold text-emerald-400">{fmtUsd(payoutRunRateCents)}</b>
                <span className="mx-2 text-zinc-700">·</span>
                Horizon retained{" "}
                <b className="font-semibold text-zinc-100">
                  {fmtUsd(marketplace.retainedRunRateCents)}
                </b>
              </p>
              <div className="mt-4 space-y-1.5 text-xs text-zinc-500">
                <p>
                  <span className="text-zinc-400">ⓘ</span> Admin sees the full 100% — gross, both
                  shares, and fees. Providers see only their own share.
                </p>
                {/* Mandatory footnote (§9) -- must not imply "no money" or "verified money". */}
                <p>
                  <span className="text-zinc-400">◷</span>{" "}
                  <b className="font-semibold text-zinc-400">Contracted run-rate</b> — price × split
                  across live tiers. Not reconciled against payments received.
                </p>
              </div>
            </section>
          )}
      </>
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
