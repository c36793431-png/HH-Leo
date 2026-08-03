"use client";

import { useActionState, useEffect, useRef } from "react";
import { LICENSE_TIERS } from "@/lib/licenses";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

/** Not a member of LICENSE_TIERS and deliberately not one: "free" is the ABSENCE of an
 * active license (see 0012 — licenses_tier_check only permits trial/paid/team/deal), so
 * selecting it revokes rather than writing a tier. Kept as a select option purely so one
 * dropdown covers the whole lifecycle. */
const FREE_OPTION = "free";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface TierSelectFormProps {
  action: Action;
  hiddenFields?: Record<string, string>;
  currentTier: string;
  /** When set, changing the tier asks for confirmation naming this subject (an email, usually)
   * before submitting. A plain string rather than a message-building callback because this is
   * rendered from a Server Component, which cannot pass functions across the RSC boundary. */
  confirmSubject?: string;
  /** Names the subject in the REVOKE prompt only. Separate from confirmSubject because that
   * one doubles as the "confirm tier changes at all" switch — /admin/licenses wants the
   * destructive prompt to name the user without gaining confirmation on ordinary tier
   * changes, which it has never had. Falls back to confirmSubject, then "this user". */
  revokeSubject?: string;
  /** Supplying this adds a "free" option that REVOKES instead of setting a tier. Omit it and
   * no "free" option is rendered at all — offering one with nothing to call would silently
   * do nothing. Each page passes its own revoke action so the audit entry
   * (admin_users_revoke vs admin_licenses_revoke) and revalidation stay page-correct. */
  revokeAction?: Action;
}

/** Inline tier dropdown — auto-submits on change, same success/error toast contract as
 * ActionButton/DurationForm, so coxwell can flip a license's tier without touching SQL.
 * Two independent forms: the tier write and the revoke each need their own useActionState,
 * since they have separate pending/result states and separate toasts. */
export function TierSelectForm({
  action,
  hiddenFields = {},
  currentTier,
  confirmSubject,
  revokeSubject,
  revokeAction,
}: TierSelectFormProps) {
  const [tierState, tierFormAction, tierPending] = useActionState(action, null);
  const [revokeState, revokeFormAction, revokePending] = useActionState(revokeAction ?? action, null);
  const tierFormRef = useRef<HTMLFormElement>(null);
  const revokeFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (tierState === null) return;
    emitToast(tierState.ok ? "Tier updated" : tierState.error, tierState.ok ? "success" : "error");
  }, [tierState]);

  useEffect(() => {
    if (revokeState === null) return;
    emitToast(revokeState.ok ? "License revoked" : revokeState.error, revokeState.ok ? "success" : "error");
  }, [revokeState]);

  const revokeName = revokeSubject ?? confirmSubject ?? "this user";

  return (
    <>
      <form ref={tierFormRef} action={tierFormAction}>
        {Object.entries(hiddenFields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <select
          name="tier"
          defaultValue={currentTier}
          disabled={tierPending || revokePending}
          onChange={(e) => {
            const next = e.target.value;

            if (next === FREE_OPTION) {
              // Destructive, so this confirms unconditionally — unlike the tier path it does
              // not wait on confirmSubject being supplied.
              if (!window.confirm(`Revoke ${revokeName}'s license? They will lose access.`)) {
                e.target.value = currentTier;
                return;
              }
              revokeFormRef.current?.requestSubmit();
              return;
            }

            if (confirmSubject && !window.confirm(`Change ${confirmSubject}'s tier to ${next}?`)) {
              // Put the visible selection back — the dropdown has already moved to the
              // new value by the time onChange fires, so cancelling has to undo it.
              e.target.value = currentTier;
              return;
            }
            tierFormRef.current?.requestSubmit();
          }}
          className="rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200 disabled:opacity-50"
        >
          {LICENSE_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          {revokeAction && <option value={FREE_OPTION}>{FREE_OPTION}</option>}
        </select>
      </form>

      {/* Separate form so the revoke posts only licenseId — never the `tier` select value,
          which would be the string "free" and is not a valid tier. */}
      {revokeAction && (
        <form ref={revokeFormRef} action={revokeFormAction} className="hidden">
          {Object.entries(hiddenFields).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
        </form>
      )}
    </>
  );
}
