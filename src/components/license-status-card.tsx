"use client";

import { useState } from "react";
import { computeLicenseDisplayStatus, type LicenseDetail } from "@/lib/licenses";
import { formatAbsoluteUtc } from "@/lib/format-time";

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function LicenseStatusCard({
  license,
  telegramChannelUrl,
  isAdminAccount = false,
}: {
  license: LicenseDetail | null;
  telegramChannelUrl: string;
  isAdminAccount?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now] = useState(() => new Date());

  const displayStatus = computeLicenseDisplayStatus(license, now);
  const isActive = displayStatus === "active" || displayStatus === "expiring";

  if (!license || !isActive) {
    const label = displayStatus === "revoked" ? "Revoked" : license ? `Expired ${formatAbsoluteUtc(license.expiresAt)}` : "No active license";
    return (
      <div className="card full">
        <div className="chead">
          <span className="ic">◐</span>
          <h3>License status</h3>
          <span className="cap">Overview</span>
        </div>
        <div className="lic-free">
          <span className="lic-badge">
            <span className="dot" /> {label}
          </span>
          <div className="txt">
            <b>You&apos;re on the free tier.</b>
            <p>Downloads and the Paid Users group are locked. Upgrade to activate a license key and unlock every section.</p>
          </div>
          <a className="btn primary" href={telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Upgrade
          </a>
        </div>
      </div>
    );
  }

  const isExpiring = displayStatus === "expiring";
  const msRemaining = Math.max(0, license.expiresAt.getTime() - now.getTime());
  const totalDays = Math.max(1, daysBetween(license.expiresAt, license.issuedAt));
  const daysLeft = Math.max(0, daysBetween(license.expiresAt, now));
  const pct = Math.round(Math.min(100, Math.max(0, (daysLeft / totalDays) * 100)));
  const masked = license.licenseKey.replace(/.(?=.{4})/g, "•");

  let ringValue: number;
  let ringUnit: string;
  if (msRemaining < 60 * 60 * 1000) {
    ringValue = Math.ceil(msRemaining / 60_000);
    ringUnit = "minutes left";
  } else if (msRemaining < 24 * 60 * 60 * 1000) {
    ringValue = Math.ceil(msRemaining / 3_600_000);
    ringUnit = "hours left";
  } else {
    ringValue = daysLeft;
    ringUnit = "days left";
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(license!.licenseKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <div className="card full">
      <div className="chead">
        <span className="ic">◐</span>
        <h3>License status</h3>
        <span className="cap">{isAdminAccount ? "Your account" : "Overview"}</span>
      </div>
      <div className="lic-active">
        <div className={`ring${isExpiring ? " warn" : ""}`} style={{ "--pct": pct } as React.CSSProperties}>
          <div className="rin">
            <b>{ringValue}</b>
            <span>{ringUnit}</span>
          </div>
        </div>
        <div className="body">
          <span className={`badge-ok${isExpiring ? " expiring" : ""}`}>
            <span className="dot" /> {isExpiring ? "Expiring" : "Active"}
          </span>
          <h3>Horizon HFT — {license.tier} license</h3>
          <p>
            {isAdminAccount && "Admin access is independent of license state. "}
            Valid until <b>{formatAbsoluteUtc(license.expiresAt)}</b>
          </p>
          <div className="keyrow">
            <span className="k">{revealed ? license.licenseKey : masked}</span>
            <button type="button" className="copy" onClick={() => setRevealed((v) => !v)}>
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button type="button" className="copy" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
