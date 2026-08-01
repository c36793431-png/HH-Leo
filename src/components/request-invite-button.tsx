"use client";

import { useState, useTransition } from "react";
import { requestPaidGroupInviteAction } from "@/app/dashboard/actions";

export function RequestInviteButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  return (
    <div className="rcta-col">
      <button
        type="button"
        className="rcta rcta-btn"
        disabled={pending || sent}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await requestPaidGroupInviteAction();
            if (!result.ok) setError(result.error);
            else setSent(true);
          });
        }}
      >
        {pending ? "Sending…" : sent ? "Invite sent — check Telegram" : label}
      </button>
      {error && <span className="rcta-err">{error}</span>}
    </div>
  );
}
