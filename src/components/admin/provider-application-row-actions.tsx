"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface ProviderApplicationRowActionsProps {
  applicationId: string;
  approveAction: Action;
  declineAction: Action;
}

/** Approve/decline pair for one /admin/provider-applications row. Approve flips the app to
 * 'approved' (pending onboarding) then navigates into /admin/register-provider to hydrate the
 * pre-fill contract (Iris, feed-admin-split thread, 2026-08-23) -- register-provider's own
 * submit is what mints provider_tiers + stamps onboarded_at (Live). Decline prompts for an
 * optional note, same pattern as PartnerApplicationRowActions. */
export function ProviderApplicationRowActions({
  applicationId,
  approveAction,
  declineAction,
}: ProviderApplicationRowActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  function approve() {
    const formData = new FormData();
    formData.append("id", applicationId);
    startTransition(async () => {
      const result = await approveAction(null, formData);
      if (result.ok) {
        emitToast("Approved", "success");
        router.push(`/admin/register-provider?from_application=${applicationId}`);
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  function decline() {
    const formData = new FormData();
    formData.append("id", applicationId);
    formData.append("adminNotes", note);
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
          className="rounded bg-emerald-500 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
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
            placeholder="Note (optional)…"
            className="w-48 rounded border border-zinc-700 bg-black/40 px-1.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50"
          />
          <p className="w-48 text-[10px] leading-snug text-zinc-500">The row moves to Declined — nothing is deleted.</p>
          <button
            type="button"
            onClick={decline}
            disabled={pending}
            className="self-start rounded border border-red-600/50 px-2 py-0.5 text-[11px] text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Submitting…" : "Confirm decline"}
          </button>
        </div>
      )}
    </div>
  );
}
