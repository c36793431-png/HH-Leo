"use client";

import { useState, useTransition } from "react";
import { setNotificationPrefAction } from "@/app/feed/dashboard/actions";
import { emitToast } from "@/lib/toast-bus";
import type { NotificationEventKey } from "@/lib/notification-prefs";

interface NotificationToggleProps {
  eventKey: NotificationEventKey;
  initialEnabled: boolean;
}

export function NotificationToggle({ eventKey, initialEnabled }: NotificationToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setNotificationPrefAction(eventKey, next);
      if (!result.ok) {
        setEnabled(!next);
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Toggle notification"
      className={`tog${enabled ? " on" : ""}`}
      onClick={handleToggle}
      disabled={isPending}
      style={{ appearance: "none", WebkitAppearance: "none", padding: 0, cursor: "pointer" }}
    />
  );
}
