"use client";

import { useState } from "react";

/** Copies a raw value (user id, license id) to the clipboard — pure client-side, no
 * server action needed since nothing is mutated. */
export function CopyIdButton({ value, label = "Copy user ID" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
