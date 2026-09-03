"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { FeedTierPickerRow, SubscriberFeedTierSubscription } from "@/lib/feed-subscriptions";
import { emitToast } from "@/lib/toast-bus";
import { FEED_REGION_TYPE, FEED_REGIONS, isFeedRegion, regionForFeedType, type FeedRegion } from "@/lib/feed-tier-catalogue";
import type { FeedType } from "@/lib/licenses";
import { formatRelative } from "@/lib/format-time";

const NO_ACCESS_OPTION = "__none__";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

/** A region with no FEED_REGION_TYPE mapping (cme today) has no licence concept at all yet,
 * so it can't be gated by entitlement -- same "ungated" treatment feed-subscriptions.ts's
 * EFFECTIVE_STATUS_SQL gives it on the provider-facing side. A region the client already has
 * a subscription row in (any status) also stays visible even if entitlement has since lapsed,
 * so admin can still see/deactivate it rather than losing the control entirely. */
function isRegionOfferable(regionKey: string, entitledFeedTypes: Set<FeedType>, hasExistingSubscription: boolean): boolean {
  if (hasExistingSubscription) return true;
  if (!isFeedRegion(regionKey)) return true;
  const feedType = FEED_REGION_TYPE[regionKey];
  if (feedType === null) return true;
  return entitledFeedTypes.has(feedType);
}

export interface FeedAssignmentRow {
  regionKey: string;
  /** "unavailable" -- client is entitled to this region but the catalogue has no tiers for
   * it yet (tokyo today). Rendered as a disabled row naming the reason rather than hidden,
   * so the entitlement isn't silently unfulfillable-looking (Item C,
   * feed-subscription-recording-build-2026-09-03). */
  kind: "assignable" | "unavailable";
  tiers: FeedTierPickerRow[];
  subscription: SubscriberFeedTierSubscription | null;
  /** True when this row is only offerable because of an existing subscription row, not
   * current licence entitlement (e.g. the licence expired/downgraded after the assignment
   * was made). Never true for an already-lapsed subscription -- that's the separate
   * "Access ended" state. */
  entitlementLapsed: boolean;
}

/** Single source of truth for which regions render on /admin/users/[id]'s feed-assignment
 * block and what each one shows -- both the block's visibility (page.tsx) and its contents
 * (FeedTierSelectForm below) read this same computed list, so they can't drift apart
 * (Item A, feed-subscription-recording-build-2026-09-03, marcus ruling). */
export function computeFeedAssignmentRows(
  tiers: FeedTierPickerRow[],
  subscriptions: SubscriberFeedTierSubscription[],
  entitledFeedTypes: FeedType[]
): FeedAssignmentRow[] {
  const entitled = new Set(entitledFeedTypes);
  const rows: FeedAssignmentRow[] = [];
  const seen = new Set<string>();

  const catalogueRegions = [...new Set(tiers.map((t) => t.regionKey))];
  for (const regionKey of catalogueRegions) {
    const subscription = subscriptions.find((s) => s.regionKey === regionKey) ?? null;
    const hasExistingSubscription = subscription !== null;
    if (!isRegionOfferable(regionKey, entitled, hasExistingSubscription)) continue;
    seen.add(regionKey);
    const feedType = isFeedRegion(regionKey) ? FEED_REGION_TYPE[regionKey] : null;
    const isCurrentlyEntitled = feedType === null ? true : entitled.has(feedType);
    rows.push({
      regionKey,
      kind: "assignable",
      tiers: tiers.filter((t) => t.regionKey === regionKey),
      subscription,
      entitlementLapsed: hasExistingSubscription && !isCurrentlyEntitled && subscription?.status !== "lapsed",
    });
  }

  // Entitled regions the catalogue has no tiers for at all (tokyo today) never surface via
  // the loop above since they have no rows in `tiers` to begin with.
  for (const feedType of entitled) {
    const regionKey = regionForFeedType(feedType);
    if (!regionKey || seen.has(regionKey)) continue;
    seen.add(regionKey);
    rows.push({ regionKey, kind: "unavailable", tiers: [], subscription: null, entitlementLapsed: false });
  }

  return rows.sort(
    (a, b) => FEED_REGIONS.indexOf(a.regionKey as FeedRegion) - FEED_REGIONS.indexOf(b.regionKey as FeedRegion)
  );
}

interface FeedTierSelectFormProps {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  rows: FeedAssignmentRow[];
  subjectName: string;
}

/** Feed provider assignment control for /admin/users/[id] -- one row per region the client
 * is either entitled to (licenses.feed_types) or already has a subscription in. `rows` is
 * computed once by the caller via computeFeedAssignmentRows and also drives whether the
 * surrounding block renders at all, so this component never re-derives the region list. */
export function FeedTierSelectForm({ assignAction, deactivateAction, userId, rows, subjectName }: FeedTierSelectFormProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) =>
        row.kind === "unavailable" ? (
          <FeedTierUnavailableRow key={row.regionKey} regionKey={row.regionKey} />
        ) : (
          <FeedTierRegionControl
            key={row.regionKey}
            assignAction={assignAction}
            deactivateAction={deactivateAction}
            userId={userId}
            regionKey={row.regionKey}
            tiers={row.tiers}
            subscription={row.subscription}
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

/** Own useActionState pair per region (same reason as the license tier-select-form.tsx this
 * pattern is copied from: separate pending/result/toast per action) -- split into a child
 * component rather than called in a loop from the parent so each region's hooks are a
 * distinct component instance, not multiple hook calls in one render. */
function FeedTierRegionControl({
  assignAction,
  deactivateAction,
  userId,
  regionKey,
  tiers,
  subscription,
  entitlementLapsed,
  subjectName,
}: {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  regionKey: string;
  tiers: FeedTierPickerRow[];
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
  const currentTierKey = subscription && !isLapsed ? subscription.tierKey : null;
  const selectValue = currentTierKey ?? NO_ACCESS_OPTION;
  const regionLabel = REGION_LABELS[regionKey] ?? regionKey;

  // Three distinguishable states, never the same string for two of them: never assigned a
  // provider, deliberately ended (lapsed_at set), and (via the tier options below) assigned.
  const placeholderLabel = isLapsed
    ? `Access ended${subscription?.lapsedAt ? ` (${formatRelative(subscription.lapsedAt)})` : ""}`
    : "Not assigned to a provider yet";

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-zinc-500">{regionLabel}</span>
      <div className="flex flex-col gap-0.5">
        <form ref={assignFormRef} action={assignFormAction}>
          <input type="hidden" name="userId" value={userId} />
          <select
            name="tierKey"
            defaultValue={selectValue}
            disabled={assignPending || deactivatePending}
            onChange={(e) => {
              const next = e.target.value;

              if (next === NO_ACCESS_OPTION) {
                if (
                  !window.confirm(
                    `Deactivate ${subjectName}'s ${regionLabel} feed provider assignment? They will lose feed access.`
                  )
                ) {
                  e.target.value = selectValue;
                  return;
                }
                deactivateFormRef.current?.requestSubmit();
                return;
              }

              if (
                !window.confirm(`Set ${subjectName}'s ${regionLabel} feed tier to ${e.target.selectedOptions[0].text}?`)
              ) {
                e.target.value = selectValue;
                return;
              }
              assignFormRef.current?.requestSubmit();
            }}
            className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
          >
            <option value={NO_ACCESS_OPTION}>{placeholderLabel}</option>
            {tiers.map((t) => (
              // Reassigning to a different tier isn't offered once entitlement has lapsed --
              // deactivate (the NO_ACCESS_OPTION above) stays the only enabled action besides
              // the current, already-selected value (Item D).
              <option key={t.tierKey} value={t.tierKey} disabled={entitlementLapsed}>
                {t.name}
                {!t.providerUserId ? " (unassigned)" : ""}
              </option>
            ))}
          </select>
        </form>
        {entitlementLapsed && (
          <span className="text-[10px] text-amber-500">Entitlement lapsed — assignment retained</span>
        )}
      </div>

      {/* Separate form so deactivate posts only userId + region, never a tierKey value. */}
      <form ref={deactivateFormRef} action={deactivateFormAction} className="hidden">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="region" value={regionKey} />
      </form>
    </div>
  );
}
