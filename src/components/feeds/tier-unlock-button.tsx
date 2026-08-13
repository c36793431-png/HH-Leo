"use client";

import { useState, useTransition } from "react";
import { submitFeedTierRequestAction } from "@/app/feeds/actions";
import { emitToast } from "@/lib/toast-bus";

export function TierUnlockButton({ region, tierKey }: { region: string; tierKey: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (submitted) {
    return <p className="ftd-submitted">Request submitted — we&apos;ll be in touch.</p>;
  }

  function handleClick() {
    const formData = new FormData();
    formData.set("region", region);
    formData.set("tierKey", tierKey);
    startTransition(async () => {
      const result = await submitFeedTierRequestAction(null, formData);
      if (result.ok) {
        setSubmitted(true);
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <button type="button" className="btn primary sm ftd-unlock" onClick={handleClick} disabled={isPending}>
      {isPending ? "Submitting…" : "Unlock"}
    </button>
  );
}
