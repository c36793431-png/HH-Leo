"use client";

import { useEffect, useId, useState } from "react";
import { linkTelegramAction } from "@/app/dashboard/actions";

interface TelegramWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function LinkTelegramButton({ botUsername }: { botUsername: string }) {
  const [error, setError] = useState<string | null>(null);
  const callbackName = `tgLink${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const containerId = `${callbackName}Container`;

  useEffect(() => {
    (window as unknown as Record<string, unknown>)[callbackName] = (
      user: TelegramWidgetUser
    ) => {
      setError(null);
      linkTelegramAction({ ...user, auth_date: user.auth_date }).catch((err: Error) =>
        setError(err.message)
      );
    };

    const container = document.getElementById(containerId);
    if (!container) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `${callbackName}(user)`);
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
  }, [botUsername, callbackName, containerId]);

  return (
    <div className="flex flex-col gap-2">
      <div id={containerId} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
