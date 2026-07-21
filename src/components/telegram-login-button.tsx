"use client";

import { useEffect, useId } from "react";
import { signIn } from "next-auth/react";

interface TelegramWidgetUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function TelegramLoginButton({
  botUsername,
  redirectTo,
}: {
  botUsername: string;
  redirectTo: string;
}) {
  const callbackName = `tgAuth${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const containerId = `${callbackName}Container`;

  useEffect(() => {
    (window as unknown as Record<string, unknown>)[callbackName] = (
      user: TelegramWidgetUser
    ) => {
      void signIn("telegram", {
        ...user,
        auth_date: String(user.auth_date),
        redirectTo,
      });
    };

    const container = document.getElementById(containerId);
    if (!container) return;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    // request_access=write is required — without it the bot cannot DM users at all.
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `${callbackName}(user)`);
    container.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>)[callbackName];
    };
  }, [botUsername, callbackName, containerId, redirectTo]);

  return <div id={containerId} />;
}
