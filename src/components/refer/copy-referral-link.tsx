"use client";

import { useState } from "react";

export function CopyReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <div className="keyrow" style={{ maxWidth: 480 }}>
      <span className="k">{link}</span>
      <button type="button" className="copy" onClick={handleCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
