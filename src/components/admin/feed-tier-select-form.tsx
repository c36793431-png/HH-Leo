"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { FeedAssignmentRow, FeedTierPickerRow, SubscriberFeedTierSubscription } from "@/lib/feed-subscriptions";
import { emitToast } from "@/lib/toast-bus";
import { formatRelative } from "@/lib/format-time";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

interface FeedTierSelectFormProps {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  rows: FeedAssignmentRow[];
  subjectName: string;
}

/** Feed provider assignment control for /admin/users/[id] -- one block per region the client
 * is either entitled to (licenses.feed_types) or already has a subscription in, and within an
 * assignable region, one independent toggle per catalogue tier. `rows` is computed once by the
 * caller via computeFeedAssignmentRows (lib/feed-subscriptions.ts) and also drives whether the
 * surrounding block renders at all, so this component never re-derives the region/tier list.
 *
 * Rewritten during the region-to-tier-key migration (thread
 * leo-region-vs-tier-subscription-key-collision-2026-09-03) from a single dropdown per region
 * (which could only ever show/select ONE tier, silently hiding any others already granted in
 * the same region -- the London Base package holds three at once) to one toggle per tier. This
 * is a stopgap shaped by what the existing per-region hidden-form pattern already supported,
 * not a signed-off UX redesign -- coxwell/marcus should treat the interaction model (independent
 * per-tier toggles vs. some other affordance) as still open for review, separate from the
 * data-correctness fix underneath it. */
export function FeedTierSelectForm({ assignAction, deactivateAction, userId, rows, subjectName }: FeedTierSelectFormProps) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) =>
        row.kind === "unavailable" ? (
          <FeedTierUnavailableRow key={row.regionKey} regionKey={row.regionKey} />
        ) : (
          <FeedRegionBlock
            key={row.regionKey}
            assignAction={assignAction}
            deactivateAction={deactivateAction}
            userId={userId}
            regionKey={row.regionKey}
            tiers={row.tiers}
            subscriptions={row.subscriptions}
            entitlementLapsed={row.entitlementLapsed}
            subjectName={subjectName}
          />
        )
      )}
    </div>
  );
}

/** A region the client is entitled to but the catalogue has no tiers for -- named so an
 * unfulfillable entitlement isn't indistinguishable from a broken page (Item C). */
function FeedTierUnavailableRow({ regionKey }: { regionKey: string }) {
  const regionLabel = REGION_LABELS[regionKey] ?? regionKey;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-zinc-500">{regionLabel}</span>
      <span className="text-xs italic text-zinc-600">No provider tiers available yet</span>
    </div>
  );
}

function FeedRegionBlock({
  assignAction,
  deactivateAction,
  userId,
  regionKey,
  tiers,
  subscriptions,
  entitlementLapsed,
  subjectName,
}: {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  regionKey: string;
  tiers: FeedTierPickerRow[];
  subscriptions: SubscriberFeedTierSubscription[];
  entitlementLapsed: boolean;
  subjectName: string;
}) {
  const regionLabel = REGION_LABELS[regionKey] ?? regionKey;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{regionLabel}</span>
      <div className="flex flex-col gap-0.5 pl-2">
        {tiers.map((tier) => (
          <FeedTierRowControl
            key={tier.tierKey}
            assignAction={assignAction}
            deactivateAction={deactivateAction}
            userId={userId}
            regionLabel={regionLabel}
            tier={tier}
            subscription={subscriptions.find((s) => s.tierKey === tier.tierKey) ?? null}
            entitlementLapsed={entitlementLapsed}
            subjectName={subjectName}
          />
        ))}
      </div>
      {entitlementLapsed && <span className="pl-2 text-[10px] text-amber-500">Entitlement lapsed — assignments retained</span>}
    </div>
  );
}

/** Own useActionState pair per (region, tier) -- same reason as before this rewrite (separate
 * pending/result/toast per action), just one instance per tier now instead of per region, since
 * assignFeedTierSubscription/deactivateFeedTierSubscription are themselves per-tier operations. */
function FeedTierRowControl({
  assignAction,
  deactivateAction,
  userId,
  regionLabel,
  tier,
  subscription,
  entitlementLapsed,
  subjectName,
}: {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  regionLabel: string;
  tier: FeedTierPickerRow;
  subscription: SubscriberFeedTierSubscription | null;
  entitlementLapsed: boolean;
  subjectName: string;
}) {
  const [assignState, assignFormAction, assignPending] = useActionState(assignAction, null);
  const [deactivateState, deactivateFormAction, deactivatePending] = useActionState(deactivateAction, null);
  const assignFormRef = useRef<HTMLFormElement>(null);
  const deactivateFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (assignState === null) return;
    emitToast(assignState.ok ? "Feed tier assigned" : assignState.error, assignState.ok ? "success" : "error");
  }, [assignState]);

  useEffect(() => {
    if (deactivateState === null) return;
    emitToast(
      deactivateState.ok ? "Feed subscription deactivated" : deactivateState.error,
      deactivateState.ok ? "success" : "error"
    );
  }, [deactivateState]);

  const isLapsed = subscription?.status === "lapsed";
  const isActive = subscription !== null && !isLapsed;
  const pending = assignPending || deactivatePending;

  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs ${isActive ? "text-zinc-200" : "text-zinc-500"}`}>
        {tier.name}
        {!tier.providerUserId ? " (unassigned)" : ""}
      </span>
      {isLapsed && subscription?.lapsedAt && (
        <span className="text-[10px] text-zinc-600">Ended {formatRelative(subscription.lapsedAt)}</span>
      )}

      <form ref={assignFormRef} action={assignFormAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="tierKey" value={tier.tierKey} />
        <button
          type="button"
          disabled={pending || isActive || entitlementLapsed}
          onClick={() => {
            if (!window.confirm(`Grant ${subjectName} access to ${tier.name} (${regionLabel})?`)) return;
            assignFormRef.current?.requestSubmit();
          }}
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          Grant
        </button>
      </form>

      <form ref={deactivateFormRef} action={deactivateFormAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="tierKey" value={tier.tierKey} />
        <button
          type="button"
          disabled={pending || !isActive}
          onClick={() => {
            if (!window.confirm(`Deactivate ${subjectName}'s ${tier.name} (${regionLabel}) feed access?`)) return;
            deactivateFormRef.current?.requestSubmit();
          }}
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          Revoke
        </button>
      </form>
    </div>
  );
}
