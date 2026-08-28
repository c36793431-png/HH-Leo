"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";
import { EDITABLE_USER_ROLES } from "@/lib/admin-user-roles";

interface RoleSelectFieldProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  hiddenFields?: Record<string, string>;
  currentRole: string;
  subjectName: string;
  isSelf: boolean;
}

/** Role guards an access boundary, so unlike the other Profile fields it's never behind
 * an edit toggle: chrome (border + chevron) says "editable", plain zinc text says
 * "read-only" — changing the select value IS the edit, confirmed by a dialog before it
 * submits. Two-value fields don't need reveal-then-edit. */
const ROLE_LABELS: Record<string, string> = {
  feed_provider: "Feed provider",
  partner: "Partner",
};

export function RoleSelectField({ action, hiddenFields = {}, currentRole, subjectName, isSelf }: RoleSelectFieldProps) {
  const [current, setCurrent] = useState(currentRole);
  const [draft, setDraft] = useState(currentRole);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const editable = (EDITABLE_USER_ROLES as readonly string[]).includes(currentRole);
  const dirty = editable && draft !== current;
  const isDemote = draft === "user" && current === "admin";

  if (!editable) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-500">Role</label>
        <p className="text-sm text-zinc-200">{ROLE_LABELS[currentRole] ?? currentRole}</p>
      </div>
    );
  }

  function closeAndReset() {
    setConfirmOpen(false);
    setDraft(current);
  }

  function handleConfirm() {
    const formData = new FormData();
    for (const [key, val] of Object.entries(hiddenFields)) formData.append(key, val);
    formData.append("field", "role");
    formData.append("value", draft);

    startTransition(async () => {
      const result = await action(null, formData);
      setConfirmOpen(false);
      if (result.ok) {
        setCurrent(draft);
        emitToast("Role updated", "success");
      } else {
        setDraft(current);
        emitToast(result.error, "error");
      }
    });
  }

  const dialogCopy = isSelf
    ? "You're removing your own admin access. You'll be signed out of the admin area and can't undo this yourself."
    : isDemote
      ? `Change ${subjectName} from Admin to User? They'll immediately lose admin access.`
      : `Change ${subjectName} from User to Admin? They'll gain admin access immediately.`;

  const primaryClass = isSelf
    ? "rounded border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
    : "rounded border border-cyan-500/60 bg-cyan-500/15 px-3 py-2 text-sm font-medium text-cyan-300 hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="role-select" className="text-xs text-zinc-500">
        Role
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto">
          <select
            id="role-select"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isPending}
            className="min-h-[44px] w-full appearance-none rounded border border-cyan-500/60 bg-zinc-800 px-2.5 py-2 pr-8 text-sm text-zinc-200 disabled:opacity-50 sm:h-8 sm:min-h-0 sm:w-auto sm:py-1 sm:text-xs"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isPending}
            className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
          >
            Save role
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
            <p className="text-sm text-zinc-200">{dialogCopy}</p>
            <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
              <button
                type="button"
                autoFocus={isSelf}
                onClick={closeAndReset}
                disabled={isPending}
                className="w-full rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50 sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus={!isSelf}
                onClick={handleConfirm}
                disabled={isPending}
                className={`w-full sm:w-auto ${primaryClass}`}
              >
                {isPending ? "Changing…" : "Change role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
