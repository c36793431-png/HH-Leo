"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { FeedTierPickerRow, SubscriberFeedTierSubscription } from "@/lib/feed-subscriptions";
import { emitToast } from "@/lib/toast-bus";

const NO_ACCESS_OPTION = "__none__";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

interface FeedTierSelectFormProps {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  tiers: FeedTierPickerRow[];
  subscriptions: SubscriberFeedTierSubscription[];
  subjectName: string;
}

/** Feed-subscription control for /admin/users/[id] -- one control per REGION present in the
 * catalogue, not a single global select. A client can hold Horizon-catalogue access in more
 * than one region at once (London Base and NY are separately purchasable packages), so the
 * grain here mirrors lib/feed-subscriptions.ts's (subscriber, region) grain (bus thread
 * feed-subscription-recording-build-2026-09-03, marcus ruling). Regions are derived from the
 * tiers actually present in feed_tiers, so a third region needs no change here. */
export function FeedTierSelectForm({
  assignAction,
  deactivateAction,
  userId,
  tiers,
  subscriptions,
  subjectName,
}: FeedTierSelectFormProps) {
  const regions: string[] = [];
  for (const t of tiers) {
    if (!regions.includes(t.regionKey)) regions.push(t.regionKey);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {regions.map((regionKey) => (
        <FeedTierRegionControl
          key={regionKey}
          assignAction={assignAction}
          deactivateAction={deactivateAction}
          userId={userId}
          regionKey={regionKey}
          tiers={tiers.filter((t) => t.regionKey === regionKey)}
          currentTierKey={
            subscriptions.find((s) => s.regionKey === regionKey && s.status !== "lapsed")?.tierKey ?? null
          }
          subjectName={subjectName}
        />
      ))}
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
  currentTierKey,
  subjectName,
}: {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  regionKey: string;
  tiers: FeedTierPickerRow[];
  currentTierKey: string | null;
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

  const selectValue = currentTierKey ?? NO_ACCESS_OPTION;
  const regionLabel = REGION_LABELS[regionKey] ?? regionKey;

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-zinc-500">{regionLabel}</span>
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
                  `Deactivate ${subjectName}'s ${regionLabel} feed subscription? They will lose feed access.`
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
          <option value={NO_ACCESS_OPTION}>No feed access</option>
          {tiers.map((t) => (
            <option key={t.tierKey} value={t.tierKey}>
              {t.name}
              {!t.providerUserId ? " (unassigned)" : ""}
            </option>
          ))}
        </select>
      </form>

      {/* Separate form so deactivate posts only userId + region, never a tierKey value. */}
      <form ref={deactivateFormRef} action={deactivateFormAction} className="hidden">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="region" value={regionKey} />
      </form>
    </div>
  );
}
