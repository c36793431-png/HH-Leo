"use client";

import { useTransition } from "react";
import { unlinkTelegramFeedsAction, sendTelegramFeedsTestAction } from "@/app/feed/dashboard/actions";
import { emitToast } from "@/lib/toast-bus";

interface TelegramDeliveryControlProps {
  linked: boolean;
  telegramUsername: string | null;
  /** Deep link to start the bot, or null if the bot isn't configured (missing token) --
   * shows an honest "not configured" message instead of a dead button. */
  linkHref: string | null;
}

export function TelegramDeliveryControl({ linked, telegramUsername, linkHref }: TelegramDeliveryControlProps) {
  const [isPending, startTransition] = useTransition();

  function handleUnlink() {
    startTransition(async () => {
      const result = await unlinkTelegramFeedsAction();
      emitToast(result.ok ? "Telegram unlinked" : result.error, result.ok ? "success" : "error");
    });
  }

  function handleSendTest() {
    startTransition(async () => {
      const result = await sendTelegramFeedsTestAction();
      emitToast(result.ok ? "Test message sent" : result.error, result.ok ? "success" : "error");
    });
  }

  if (linked) {
    return (
      <div className="nrow">
        <div className="nic paid">✓</div>
        <div className="ntxt">
          <b>Telegram delivery</b>
          <span>Linked as {telegramUsername ? `@${telegramUsername}` : "your Telegram account"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          <button type="button" className="btn ghost sm" onClick={handleSendTest} disabled={isPending}>
            {isPending ? "…" : "Send test"}
          </button>
          <button type="button" className="btn ghost sm" onClick={handleUnlink} disabled={isPending}>
            {isPending ? "…" : "Unlink"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="nrow">
      <div className="nic signup">✈</div>
      <div className="ntxt">
        <b>Telegram delivery</b>
        <span>Not linked — the events above have nowhere to send yet.</span>
      </div>
      {linkHref ? (
        <a className="btn primary sm" href={linkHref} target="_blank" rel="noopener noreferrer" style={{ flex: "0 0 auto" }}>
          Link Telegram
        </a>
      ) : (
        <span style={{ fontSize: 12, color: "var(--pfp-ink-3)", flex: "0 0 auto" }}>Bot not configured yet</span>
      )}
    </div>
  );
}
