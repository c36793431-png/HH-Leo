"use client";

import { useState } from "react";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Job E, bus thread leo-provider-subscribers-page-2026-09-06 (coxwell/marcus): "a package is
 * the unit of sale" -- same ruling as Job A1's AccountPackageRows, applied to Revenue instead
 * of Subscribers. Member tiers are detail behind a disclosure, collapsed by default, never
 * the primary content of the row. */
export function PackageRevenueRow({
  label,
  memberTierNames,
  subscriberCount,
  monthlyCents,
  shareCents,
}: {
  label: string;
  memberTierNames: string[];
  subscriberCount: number;
  monthlyCents: number;
  shareCents: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <td>
          {memberTierNames.length > 0 ? (
            <button type="button" className="acct-disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span className="chev">{open ? "▾" : "▸"}</span>
              <b>{label}</b>
            </button>
          ) : (
            <b>{label}</b>
          )}
        </td>
        <td className="r mono">{subscriberCount}</td>
        <td className="r mono">{money(monthlyCents)}</td>
        <td className="r share">{money(shareCents)}</td>
      </tr>
      {open &&
        memberTierNames.map((name) => (
          <tr key={name}>
            <td style={{ paddingLeft: 28 }}>{name}</td>
            <td className="r" />
            <td className="r" />
            <td className="r" />
          </tr>
        ))}
    </>
  );
}
