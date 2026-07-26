"use client";

import type { Platform } from "@/lib/downloads";

export function DownloadButton({ version, platform }: { version: string; platform: Platform }) {
  return (
    <a
      href={`/api/download/${encodeURIComponent(version)}?platform=${platform}`}
      className="btn primary sm"
    >
      Download {platform === "windows" ? "Windows" : "macOS"}
    </a>
  );
}
