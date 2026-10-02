import { Fragment } from "react";
import { FeedTierRequestRowActions } from "@/components/admin/feed-tier-request-row-actions";
import type { ActionResult } from "@/lib/action-result";
import type { FeedTierRequestRow } from "@/lib/feed-tier-requests";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { groupRequestsByPackage } from "@/lib/request-package-groups";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Status vocabulary is pending | approved | rejected since 0086 (Source G(d)); the
 * 'provisioned' filter, stat and style are gone with it. */
const STATUS_STYLES: Record<FeedTierRequestRow["status"], string> = {
  pending: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  rejected: "border-red-500/40 bg-red-500/15 text-red-300",
};

function statusStyle(status: FeedTierRequestRow["status"]): string {
  return STATUS_STYLES[status];
}

/** Decision cell (spec section 5, Source I + fable P8): copied envelopes carry decision NULL
 * and render "-"; a self-serve trial carries decision 'trial' with no decider and renders
 * "self-serve"; an admin decision shows trial | paid with the end date and invoice ref. */
function decisionLabel(r: FeedTierRequestRow): string {
  if (!r.decision) return "—";
  if (r.decision === "trial" && r.decidedBy === null) return "self-serve";
  return r.decision;
}

/** One envelope's row. inPackage indents it under its package's label row. */
function RequestRow({
  r,
  inPackage = false,
  approveAction,
  rejectAction,
}: {
  r: FeedTierRequestRow;
  inPackage?: boolean;
  approveAction: Action;
  rejectAction: Action;
}) {
  return (
    <tr className={inPackage ? "border-l-2 border-cyan-400/50" : undefined}>
      <td className={`py-2 pr-4 text-zinc-400${inPackage ? " pl-3" : ""}`}>
        {formatAbsoluteUtc(r.createdAt)} <span className="text-zinc-600">({formatRelative(r.createdAt)})</span>
      </td>
      <td className="py-2 pr-4 text-zinc-200">
        {r.userName ?? "—"}
        <div className="text-xs text-zinc-500">{r.userEmail ?? "—"}</div>
      </td>
      <td className="py-2 pr-4 text-zinc-400">{r.licenseKeyTail ? `…${r.licenseKeyTail}` : "—"}</td>
      <td className="py-2 pr-4 text-zinc-300">
        {inPackage && <span className="text-zinc-600">└ </span>}
        {r.tierName}
        <div className="text-xs text-zinc-500 uppercase">{r.region}</div>
      </td>
      <td className="py-2 pr-4 text-zinc-400">
        {r.serverName ?? "—"}
        <div className="text-xs text-zinc-500">{r.serverIp ?? "—"}</div>
      </td>
      <td className="py-2 pr-4">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide ${statusStyle(r.status)}`}>
          {r.status.toUpperCase()}
        </span>
        {r.reason && <div className="mt-1 max-w-[12rem] text-xs text-zinc-500">{r.reason}</div>}
      </td>
      <td className="py-2 pr-4 text-zinc-300">
        {decisionLabel(r)}
        {r.endsAt && <div className="text-xs text-zinc-500">ends {formatAbsoluteUtc(r.endsAt)}</div>}
        {r.invoiceRef && <div className="text-xs text-zinc-500">inv {r.invoiceRef}</div>}
      </td>
      <td className="py-2">
        {r.status === "pending" ? (
          <FeedTierRequestRowActions requestId={r.id} approveAction={approveAction} rejectAction={rejectAction} />
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </td>
    </tr>
  );
}

/** The admin queue's table body rows. A batch that makes up a package renders as a label row
 * named for the package, then its member tiers, each with its own decision on its own envelope
 * (coxwell 2026-09-29 via marcus m57786 (a); Source F: no batch-level approve). Split out of the
 * page so it renders from fixture rows. */
export function FeedTierRequestRows({
  requests,
  approveAction,
  rejectAction,
}: {
  requests: FeedTierRequestRow[];
  approveAction: Action;
  rejectAction: Action;
}) {
  return groupRequestsByPackage(requests).map((g) =>
    g.kind === "single" ? (
      <RequestRow key={g.row.id} r={g.row} approveAction={approveAction} rejectAction={rejectAction} />
    ) : (
      <Fragment key={`batch-${g.batchId}`}>
        <tr className="border-l-2 border-cyan-400/50">
          <td colSpan={8} className="pt-3 pb-1 pl-3 text-zinc-200">
            📦 {g.label}
            <span className="ml-2 text-xs text-zinc-500">
              {g.members[0].userName ?? g.members[0].userEmail ?? "—"} · {g.members.length} tiers from one request
            </span>
          </td>
        </tr>
        {g.members.map((m) => (
          <RequestRow key={m.id} r={m} inPackage approveAction={approveAction} rejectAction={rejectAction} />
        ))}
      </Fragment>
    )
  );
}
