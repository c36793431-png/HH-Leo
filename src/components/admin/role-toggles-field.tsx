"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";
import { ALL_USER_ROLES, REVOKE_ONLY_ROLES, ROLE_LABELS, type UserRole } from "@/lib/admin-user-roles";

interface RoleTogglesFieldProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  currentRoles: string[];
  subjectName: string;
  isSelf: boolean;
}

const REVOKE_ONLY = new Set<string>(REVOKE_ONLY_ROLES);

/** Replaces the old single-select role field (role-select-field.tsx) now that an account can
 * hold more than one role at once (user_roles, migration 0075) — a dropdown can't express
 * "revoke feed_provider, keep partner". `user` renders checked and disabled: it's the floor
 * every account must keep, enforced server-side regardless of what this form submits.
 * `feed_provider`/`partner` are revoke-only — unticked-and-disabled when not already held,
 * pointing at the approval flow instead of accepting a grant here. */
export function RoleTogglesField({ action, hiddenFields = {}, currentRoles, subjectName, isSelf }: RoleTogglesFieldProps) {
  // "user" is always treated as held, even if this account predates a 0075 backfill gap --
  // the server re-adds it unconditionally, so the checkbox must never render as an
  // unchecked-but-disabled false negative.
  const current = new Set([...currentRoles, "user"]);
  const [draft, setDraft] = useState<Set<string>>(current);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();

  function toggle(role: UserRole) {
    if (role === "user") return;
    if (REVOKE_ONLY.has(role) && !current.has(role)) return; // not held -> not grantable here
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  const granted = ALL_USER_ROLES.filter((r) => !current.has(r) && draft.has(r));
  const revoked = ALL_USER_ROLES.filter((r) => current.has(r) && !draft.has(r));
  const dirty = granted.length > 0 || revoked.length > 0;
  const selfLockout = isSelf && revoked.includes("admin");
  const revokesCommercialRole = revoked.some((r) => REVOKE_ONLY.has(r));

  function closeAndReset() {
    setConfirmOpen(false);
    setDraft(new Set(current));
    setReason("");
  }

  function handleConfirm() {
    const formData = new FormData();
    for (const [key, val] of Object.entries(hiddenFields)) formData.append(key, val);
    for (const role of draft) formData.append("roles", role);
    if (reason.trim()) formData.append("reason", reason.trim());

    startTransition(async () => {
      const result = await action(null, formData);
      setConfirmOpen(false);
      if (result.ok) {
        emitToast("Roles updated", "success");
      } else {
        setDraft(new Set(current));
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">Roles</label>
      <div className="flex flex-col gap-1.5">
        {ALL_USER_ROLES.map((role) => {
          const held = current.has(role);
          const revokeOnlyAndUngrantable = REVOKE_ONLY.has(role) && !held;
          const disabled = role === "user" || revokeOnlyAndUngrantable || isPending;
          return (
            <label key={role} className={`flex items-center gap-2 text-sm ${disabled ? "text-zinc-500" : "text-zinc-200"}`}>
              <input
                type="checkbox"
                checked={draft.has(role)}
                disabled={disabled}
                onChange={() => toggle(role)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-cyan-500 disabled:opacity-50"
              />
              {ROLE_LABELS[role]}
              {role === "user" && <span className="text-xs text-zinc-600">(always held)</span>}
              {revokeOnlyAndUngrantable && (
                <span className="text-xs text-zinc-600">(granted via the approval flow, not here)</span>
              )}
            </label>
          );
        })}
        {dirty && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isPending}
            className="self-start text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
          >
            Save roles
          </button>
        )}
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) closeAndReset();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm role change"
            className="w-full rounded-t-xl border border-cyan-400/35 bg-zinc-900 p-5 sm:max-w-sm sm:rounded-xl"
          >
            <p className="text-sm text-zinc-200">
              {selfLockout
                ? "You're removing your own admin access. You'll be signed out of the admin area and can't undo this yourself."
                : `Update roles for ${subjectName}?`}
            </p>
            <ul className="mt-2 flex flex-col gap-0.5 text-xs">
              {granted.map((r) => (
                <li key={r} className="text-emerald-400">
                  + Grant {ROLE_LABELS[r]}
                </li>
              ))}
              {revoked.map((r) => (
                <li key={r} className="text-red-400">
                  − Revoke {ROLE_LABELS[r]}
                </li>
              ))}
            </ul>
            {revokesCommercialRole && (
              <p className="mt-2 text-xs text-amber-400">
                This removes panel access only — feeds are IP-allowlisted on the provider&apos;s own
                infrastructure, so revoking here does not stop delivery.
              </p>
            )}
            {revokesCommercialRole && (
              <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-400">
                Internal reason (optional, never shown to the account)
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  disabled={isPending}
                  className="rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200 disabled:opacity-50"
                />
              </label>
            )}
            <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button
                type="button"
                autoFocus={selfLockout}
                onClick={closeAndReset}
                disabled={isPending}
                className="w-full rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus={!selfLockout}
                onClick={handleConfirm}
                disabled={isPending}
                className={`w-full sm:w-auto rounded border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  selfLockout
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    : "border-cyan-500/60 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                }`}
              >
                {isPending ? "Saving…" : "Save roles"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
