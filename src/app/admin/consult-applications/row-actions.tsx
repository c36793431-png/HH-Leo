"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Approve/decline for one pending /admin/consult-applications row. Unlike PartnerApplicationRowActions, the
 * decline note is required (p3 D2.2) and private: it stays on the row and is never sent to the applicant
 * (Fable m69076 S3). */
export function ConsultApplicationRowActions({
  applicationId,
  approveAction,
  declineAction,
}: {
  applicationId: string;
  approveAction: Action;
  declineAction: Action;
}) {
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", applicationId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      emitToast(result.ok ? "Approved" : result.error, result.ok ? "success" : "error");
    });
  }

  function decline() {
    const formData = new FormData();
    formData.append("id", applicationId);
    formData.append("note", note);
    startTransition(async () => {
      const result = await declineAction(null, formData);
      emitToast(result.ok ? "Declined" : result.error, result.ok ? "success" : "error");
      if (result.ok) setDeclining(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded border border-emerald-600/50 px-2 py-0.5 text-[11px] text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setDeclining((v) => !v)}
          disabled={pending}
          className="rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {declining && (
        <div className="flex flex-col gap-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            rows={2}
            maxLength={1000}
            placeholder="Note (required, admins only, not sent)…"
            className="w-48 rounded border border-zinc-700 bg-black/40 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={decline}
            disabled={pending || note.trim() === ""}
            className="self-start rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Confirm decline"}
          </button>
        </div>
      )}
    </div>
  );
}

/** S3: an admin takes a provider's profile off the marketplace, or puts it back. The provider's own switch stays as
 * it was; the marketplace shows a profile only while both allow it (consultant-profiles.ts). */
export function ConsultProfileHideButton({ profileId, hidden, action }: { profileId: string; hidden: boolean; action: Action }) {
  const [pending, startTransition] = useTransition();
  function toggle() {
    const formData = new FormData();
    formData.append("profileId", profileId);
    formData.append("hidden", hidden ? "false" : "true");
    startTransition(async () => {
      const result = await action(null, formData);
      emitToast(result.ok ? (hidden ? "Profile back on the marketplace" : "Profile hidden") : result.error, result.ok ? "success" : "error");
    });
  }
  return (
    <button type="button" onClick={toggle} disabled={pending} className="mt-1 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50">
      {pending ? "…" : hidden ? "Unhide profile" : "Hide profile"}
    </button>
  );
}
