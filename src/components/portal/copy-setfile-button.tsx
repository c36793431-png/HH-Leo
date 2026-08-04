"use client";

import { useState } from "react";

/** Copies only the parameter values (the "param = value" text before the em dash on each
 * line), joined with " / " — never the explanation that follows the dash. */
function extractParamValues(params: string): string {
  return params
    .split("\n")
    .map((line) => line.split("—")[0].trim())
    .filter(Boolean)
    .join(" / ");
}

export function CopySetfileButton({ params }: { params: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(extractParamValues(params));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="btn ghost sm" onClick={handleCopy}>
      {copied ? "Copied ✓" : "Copy params"}
    </button>
  );
}
