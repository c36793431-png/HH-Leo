"use client";

import { useState, useTransition } from "react";
import { computeLicenseDisplayStatus, type LicenseDetail } from "@/lib/licenses";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import {
  expireTestLicenseNowAction,
  extendTestLicense30dAction,
  revokeTestLicenseAction,
} from "@/app/dashboard/license-test-actions";

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

// Keeps the first segment (product prefix) visible, masks the rest until revealed.
function maskLicenseKey(key: string): string {
  const segments = key.split("-");
  return segments.map((seg, i) => (i <= 1 ? seg : "•".repeat(seg.length))).join("-");
}

// Deterministic (not random) so the fake admin key row doesn't change between server/client render.
function fakeAdminKeySuffix(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").toUpperCase();
}

function TestActionButtons() {
  const [pending, startTransition] = useTransition();
  return (
    <div className="lic-test-actions">
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => void expireTestLicenseNowAction())}
      >
        Trigger expire now
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => void extendTestLicense30dAction())}
      >
        Extend by 30 days
      </button>
      <button
        type="button"
        className="danger"
        disabled={pending}
        onClick={() => startTransition(() => void revokeTestLicenseAction())}
      >
        Revoke
      </button>
    </div>
  );
}

export function LicenseStatusCard({
  license,
  telegramChannelUrl,
  isAdminAccount = false,
  adminLabel = "admin",
  showTestActions = false,
  installedVersion = null,
}: {
  license: LicenseDetail | null;
  telegramChannelUrl: string;
  isAdminAccount?: boolean;
  adminLabel?: string;
  showTestActions?: boolean;
  installedVersion?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [now] = useState(() => new Date());

  const displayStatus = computeLicenseDisplayStatus(license, now);
  const isActive = displayStatus === "active" || displayStatus === "expiring";

  if (isAdminAccount && !isActive) {
    const slug = (adminLabel.split("@")[0] || "admin").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "ADMIN";
    const fullKey = `HZN-ADM-0001-${slug}-${fakeAdminKeySuffix(adminLabel)}`;

    async function handleCopy() {
      try {
        await navigator.clipboard.writeText(fullKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard unavailable — no-op
      }
    }

    return (
      <div className="card full admin-lic">
        <div className="chead">
          <span className="ic">◐</span>
          <h3>License status</h3>
          <span className="cap">Your account</span>
        </div>
        <div className="lic-active">
          <div className="ring warn">
            <div className="rin">
              <b>∞</b>
              <span>admin</span>
            </div>
          </div>
          <div className="body">
            <span className="badge-ok amber">
              <span className="dot" /> ACTIVE
            </span>
            <h3>Horizon HFT — Admin / Pro</h3>
            <p>
              Admin access is independent of license state.
              {license && ` Personal license valid until ${formatAbsoluteUtc(license.expiresAt)}.`}
            </p>
            <div className="keyrow">
              <span className="k ok">{revealed ? fullKey : maskLicenseKey(fullKey)}</span>
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

  if (!license || displayStatus === "none" || displayStatus === "revoked") {
    return (
      <div className="card full">
        <div className="chead">
          <span className="ic">◐</span>
          <h3>License status</h3>
          <span className="cap">Overview</span>
        </div>
        <div className="lic-free">
          <span className={`lic-badge${displayStatus === "revoked" ? " bad" : ""}`}>
            <span className="dot" /> {displayStatus === "revoked" ? "REVOKED" : "NO LICENSE"}
          </span>
          <div className="txt">
            <b>You don&apos;t have a license yet.</b>
            <p>Downloads and the Paid Users group are locked.</p>
          </div>
          <a className="btn primary" href={telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Reach out on Telegram to get a license
          </a>
        </div>
        {showTestActions && license && displayStatus === "revoked" && <TestActionButtons />}
      </div>
    );
  }

  const isExpiring = displayStatus === "expiring";
  const isExpired = displayStatus === "expired";
  const msRemaining = Math.max(0, license.expiresAt.getTime() - now.getTime());
  const totalDays = Math.max(1, daysBetween(license.expiresAt, license.issuedAt));
  const daysLeft = Math.max(0, daysBetween(license.expiresAt, now));
  const pct = Math.round(Math.min(100, Math.max(0, (daysLeft / totalDays) * 100)));

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

  const badgeClass = isExpired ? "bad" : isExpiring ? "expiring" : isAdminAccount ? "amber" : "";
  const badgeLabel = isExpired ? "EXPIRED" : isExpiring ? "EXPIRING SOON" : "ACTIVE";

  return (
    <div className={`card full${isAdminAccount ? " admin-lic" : ""}`}>
      <div className="chead">
        <span className="ic">◐</span>
        <h3>License status</h3>
        <span className="cap">{isAdminAccount ? "Your account" : "Overview"}</span>
      </div>
      <div className="lic-active">
        <div className={`ring${isExpiring || isExpired || isAdminAccount ? " warn" : ""}`} style={{ "--pct": pct } as React.CSSProperties}>
          <div className="rin">
            <b>{ringValue}</b>
            <span>{ringUnit}</span>
          </div>
        </div>
        <div className="body">
          <span className={`badge-ok${badgeClass ? ` ${badgeClass}` : ""}`}>
            <span className="dot" /> {badgeLabel}
          </span>
          <h3>Horizon HFT — {license.tier} license</h3>
          <p>
            {isAdminAccount && "Admin access is independent of license state. "}
            {isExpired ? "Expired" : "Valid until"} <b>{formatAbsoluteUtc(license.expiresAt)}</b>
            {" "}({formatRelative(license.expiresAt)}) · issued {formatAbsoluteUtc(license.issuedAt)} · seat 1 of 1
          </p>
          <div className="keyrow">
            <span className={`k${isActive ? " ok" : " bad"}`}>
              {revealed ? license.licenseKey : maskLicenseKey(license.licenseKey)}
            </span>
            <button type="button" className="copy" onClick={() => setRevealed((v) => !v)}>
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button type="button" className="copy" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="hwid-row">
            <span>
              hwid: <b>{license.hardwareId ? `${license.hardwareId.slice(0, 4)}…` : "—"}</b>
            </span>
            <span>
              last seen:{" "}
              <b>{license.lastVerifiedAt ? formatRelative(license.lastVerifiedAt) : "never"}</b>
            </span>
          </div>
          {showTestActions && <TestActionButtons />}
        </div>
        <div className="metrics">
          <div className="m">
            <b>{installedVersion ? `v${installedVersion}` : "—"}</b>
            <span>Installed</span>
          </div>
          <div className="m">
            <b>{isExpired ? "0d" : `${daysLeft}d`}</b>
            <span>Remaining</span>
          </div>
        </div>
      </div>
    </div>
  );
}
