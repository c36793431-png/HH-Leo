import Link from "next/link";
import { notFound } from "next/navigation";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import {
  calcRetainedCents,
  getProposalRoundAdmin,
  listProposalRoundsForTierAdmin,
  listSiblingProposedTiersAdmin,
} from "@/lib/provider-tier-proposals";
import { TermsReviewCardActions } from "@/components/admin/terms-review-card-actions";
import { confirmProposalAction, declineProposalAction } from "../actions";

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<string, string> = {
  proposed: "border-cyan-400/40 bg-cyan-950/30 text-cyan-300",
  confirmed: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
  declined: "border-red-500/40 bg-red-950/20 text-red-300",
};

export default async function AdminProviderTermsReviewCard({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;

  const round = await getProposalRoundAdmin(proposalId);
  if (!round) notFound();

  const lineage = await listProposalRoundsForTierAdmin(round.applicationId, round.tierName);
  const siblingTiers = await listSiblingProposedTiersAdmin(round.applicationId, round.tierName);
  const retainedCents = calcRetainedCents(round.clientPriceCents, round.providerSplitPct);
  const retainedPct = 100 - round.providerSplitPct;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <Link href="/admin/providers" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
          ← Back to Providers
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-medium text-zinc-100">
            {round.providerName} · {round.tierName}
          </h1>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${STATUS_STYLES[round.termsStatus] ?? "border-zinc-700 bg-zinc-900 text-zinc-400"}`}
          >
            {round.termsStatus.toUpperCase()}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Round submitted {formatAbsoluteUtc(round.createdAt)} ({formatRelative(round.createdAt)})
        </p>
      </div>

      {siblingTiers.length > 0 && (
        <div className="rounded-lg border border-teal-400/30 bg-teal-950/20 p-3 text-sm text-teal-300">
          <span className="font-medium">{round.providerName}</span> also has{" "}
          {siblingTiers.map((t, i) => (
            <span key={t.tierName}>
              {i > 0 && (i === siblingTiers.length - 1 ? " and " : ", ")}
              <span className="font-medium">{t.tierName}</span> ({fmtUsd(t.clientPriceCents)}/mo · provider share{" "}
              {t.providerSplitPct}%)
            </span>
          ))}{" "}
          still pending.
          <p className="mt-1 text-[11px] text-teal-400/70">
            Deciding {round.tierName} doesn&rsquo;t touch {siblingTiers.map((t) => t.tierName).join(" or ")} — see
            both before you confirm or decline.
          </p>
        </div>
      )}

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-cyan-400">This round</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-zinc-500">Client price</dt>
            <dd className="text-zinc-200">{fmtUsd(round.clientPriceCents)}/mo</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Provider share</dt>
            <dd className="text-zinc-200">{round.providerSplitPct}%</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Trial length</dt>
            <dd className="text-zinc-200">{round.trialLengthDays} days</dd>
          </div>
        </dl>
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3 text-sm">
          <span className="text-emerald-400">you keep {retainedPct}%</span>
          <span className="ml-2 text-emerald-300">{fmtUsd(retainedCents)}/mo</span>
          <p className="mt-1 text-[11px] text-zinc-600">
            Derived, not stored — admin-only, never rendered on the provider&rsquo;s My Terms.
          </p>
        </div>
      </section>

      {round.termsStatus === "proposed" ? (
        <section className="rounded-xl border-2 border-emerald-500/50 bg-emerald-950/10 p-6">
          <h2 className="text-sm font-medium text-emerald-400">Confirm & bind terms</h2>
          <div className="mt-3">
            <TermsReviewCardActions
              proposalId={round.id}
              providerSplitPct={round.providerSplitPct}
              summaryLine={`${fmtUsd(round.clientPriceCents)}/mo · share ${round.providerSplitPct}% · you keep ${fmtUsd(retainedCents)}`}
              confirmAction={confirmProposalAction}
              declineAction={declineProposalAction}
            />
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-500">
          This round is {round.termsStatus} — no further action available here.
          {round.termsStatus === "declined" && (
            <span className="block mt-1 text-[11px] text-zinc-600">
              The decline note is private and shown only in the lineage below.
            </span>
          )}
        </section>
      )}

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-teal-400">Round lineage ({lineage.length})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Round</th>
                <th className="pb-2 pr-4">Submitted</th>
                <th className="pb-2 pr-4">Price</th>
                <th className="pb-2 pr-4">Share</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Decision note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {lineage.map((r, i) => (
                <tr key={r.id} className={r.id === round.id ? "bg-cyan-950/20" : undefined}>
                  <td className="py-2 pr-4 text-zinc-400">{i + 1}</td>
                  <td className="py-2 pr-4 text-zinc-400">{formatRelative(r.createdAt)}</td>
                  <td className="py-2 pr-4 text-zinc-300">{fmtUsd(r.clientPriceCents)}/mo</td>
                  <td className="py-2 pr-4 text-zinc-300">{r.providerSplitPct}%</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLES[r.termsStatus] ?? "border-zinc-700 bg-zinc-900 text-zinc-400"}`}
                    >
                      {r.termsStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-500">{r.declinedNote ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
