"use client";

import { useState } from "react";

export interface MonthRevenueClient {
  key: string;
  client: string;
  label: string;
  regionLabel: string;
  priceLabel: string;
  fromISO: string;
  toISO: string;
  open: boolean;
}

/** One month of Revenue's History view (marcus m49083, coxwell "yes but we need history also").
 * Same disclosure pattern as PackageRevenueRow: the month is the row, the clients behind it are
 * detail, collapsed by default.
 *
 * The money cells arrive as finished strings for the same reason the package row's do -- whether a
 * figure prints as "$30" or "unpriced" is decided by the one predicate in feed-provider-packages,
 * never by a copy in a component.
 *
 * An open period prints "2026-09-04 → ongoing", never a made-up end date: that client has not
 * agreed to stop, and a date there would read as a contracted end. */
export function MonthRevenueRow({
  label,
  clientCount,
  pricedNote,
  grossLabel,
  shareLabel,
  clients,
}: {
  label: string;
  clientCount: number;
  pricedNote: string | null;
  grossLabel: string;
  shareLabel: string;
  clients: MonthRevenueClient[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <td>
          {clients.length > 0 ? (
            <button type="button" className="acct-disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span className="chev">{open ? "▾" : "▸"}</span>
              <b>{label}</b>
            </button>
          ) : (
            <b>{label}</b>
          )}
        </td>
        <td className="r mono">{clientCount}</td>
        <td className="r mono">
          {grossLabel}
          {pricedNote && <div className="sub">{pricedNote}</div>}
        </td>
        <td className="r share">{shareLabel}</td>
      </tr>
      {open &&
        clients.map((c) => (
          <tr key={c.key}>
            <td style={{ paddingLeft: 28 }}>
              <b className="mono">{c.client}</b>
              <div className="sub">
                {c.label} · {c.regionLabel}
              </div>
            </td>
            <td className="r" />
            <td className="r mono">{c.priceLabel}</td>
            <td className="r mono">
              {c.fromISO} → {c.open ? "ongoing" : c.toISO}
            </td>
          </tr>
        ))}
    </>
  );
}
