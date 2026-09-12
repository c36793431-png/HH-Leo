"use client";

import { useState } from "react";

/** Job E, bus thread leo-provider-subscribers-page-2026-09-06 (coxwell/marcus): "a package is
 * the unit of sale" -- same ruling as Job A1's AccountPackageRows, applied to Revenue instead
 * of Subscribers. Member tiers are detail behind a disclosure, collapsed by default, never
 * the primary content of the row.
 *
 * The money cells arrive as finished strings, not cents (C3, marcus m49063). The decision of
 * whether a figure prints as "$30" or as "unpriced" belongs to the one predicate in
 * feed-provider-packages.ts, and this row used to carry its own money() copy that could only
 * ever print a dollar figure -- an all-unpriced package would have rendered "$0" here while the
 * Clients view rendered "unpriced" for the same clients. */
export function PackageRevenueRow({
  label,
  memberTierNames,
  subscriberCount,
  pricedNote,
  monthlyLabel,
  shareLabel,
}: {
  label: string;
  memberTierNames: string[];
  subscriberCount: number;
  /** "1 of 6 priced", or null when every paying client on this line carries a price. */
  pricedNote: string | null;
  monthlyLabel: string;
  shareLabel: string;
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
        <td className="r mono">
          {monthlyLabel}
          {pricedNote && <div className="sub">{pricedNote}</div>}
        </td>
        <td className="r share">{shareLabel}</td>
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
