"use client";

import { useState } from "react";

const STATUS_ICON: Record<string, string> = { trial: "🧪", active: "✓", lapsed: "✗" };

export interface AccountPackageMember {
  subscriptionId: string;
  tierName: string;
  status: "trial" | "active" | "lapsed";
  startedAtISO: string;
}

/** Job A1, bus thread leo-provider-subscribers-page-2026-09-06 (coxwell): "the package is the
 * unit of sale -- if a client has NY Base they get both NY feeds, full stop." Member feeds
 * render behind a disclosure, collapsed by default, so a recording gap (Job B, fewer member
 * rows than the package's tier keys) never reads as a smaller entitlement -- there is no
 * count anywhere on this row, visible or in aria-label, that could be compared against the
 * package's real member count. */
export function AccountPackageRows({
  pseudonym,
  label,
  status,
  share,
  serverIp,
  sinceISO,
  members,
}: {
  pseudonym: string;
  label: string;
  status: "trial" | "active" | "lapsed";
  share: string | null;
  serverIp: string | null;
  sinceISO: string;
  members: AccountPackageMember[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <td>
          <b className="mono">{pseudonym}</b>
        </td>
        <td>
          <button type="button" className="acct-disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="chev">{open ? "▾" : "▸"}</span>
            <b>{label}</b>
          </button>
        </td>
        <td>
          <span className={`tb ${status}`}>
            {STATUS_ICON[status] ?? "•"} {status}
          </span>
        </td>
        <td className="r share">{share}</td>
        <td className="mono">{serverIp ?? ""}</td>
        <td className="r mono">{sinceISO}</td>
      </tr>
      {open &&
        members.map((m) => (
          <tr key={m.subscriptionId}>
            <td />
            <td style={{ paddingLeft: 28 }}>{m.tierName}</td>
            <td>
              <span className={`tb ${m.status}`}>
                {STATUS_ICON[m.status] ?? "•"} {m.status}
              </span>
            </td>
            <td />
            <td />
            <td className="r mono">{m.startedAtISO}</td>
          </tr>
        ))}
    </>
  );
}
