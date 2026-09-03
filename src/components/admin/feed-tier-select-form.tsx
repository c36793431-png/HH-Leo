"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { FeedTierPickerRow } from "@/lib/feed-subscriptions";
import { emitToast } from "@/lib/toast-bus";

const NO_ACCESS_OPTION = "__none__";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface FeedTierSelectFormProps {
  assignAction: Action;
  deactivateAction: Action;
  userId: string;
  tiers: FeedTierPickerRow[];
  currentTierKey: string | null;
  subjectName: string;
}

const REGION_LABELS: Record<string, string> = { london: "London", ny: "New York", cme: "CME", tokyo: "Tokyo" };

/** Feed-subscription control for /admin/users/[id] -- same auto-submit-select +
 * confirm-then-revoke pattern as tier-select-form.tsx (license tier), reused here so the
 * "flip a dropdown, no SQL" convention stays consistent across the admin panel. Two
 * independent forms (assign vs deactivate) with their own useActionState, same reason as
 * the license version: separate pending/result/toast per action. */
export function FeedTierSelectForm({
  assignAction,
  deactivateAction,
  userId,
  tiers,
  currentTierKey,
  subjectName,
}: FeedTierSelectFormProps) {
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

  return (
    <>
      <form ref={assignFormRef} action={assignFormAction}>
        <input type="hidden" name="userId" value={userId} />
        <select
          name="tierKey"
          defaultValue={selectValue}
          disabled={assignPending || deactivatePending}
          onChange={(e) => {
            const next = e.target.value;

            if (next === NO_ACCESS_OPTION) {
              if (!window.confirm(`Deactivate ${subjectName}'s feed subscription? They will lose feed access.`)) {
                e.target.value = selectValue;
                return;
              }
              deactivateFormRef.current?.requestSubmit();
              return;
            }

            if (!window.confirm(`Set ${subjectName}'s feed tier to ${e.target.selectedOptions[0].text}?`)) {
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
              {REGION_LABELS[t.regionKey] ?? t.regionKey} — {t.name}
              {!t.providerUserId ? " (unassigned)" : ""}
            </option>
          ))}
        </select>
      </form>

      {/* Separate form so deactivate posts only userId, never a tierKey value. */}
      <form ref={deactivateFormRef} action={deactivateFormAction} className="hidden">
        <input type="hidden" name="userId" value={userId} />
      </form>
    </>
  );
}
