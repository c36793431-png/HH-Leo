"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PANEL_HOST, type PanelLink } from "@/lib/user-roles";

/** Cross-panel workspace card — replaces the three divergent inline switchers
 * (portal .panel-switch, feed .fp-panel-switch, partner .pd-panel-switch) with
 * one component per marcus's panel-switcher-redesign-2026-09-01 (Iris's design,
 * coxwell-picked). Current panel renders as the card header (the disclosure
 * trigger); expanding it reveals a second card listing only the other panels
 * this account can reach. Each surface supplies its own `.ws-*` CSS under its
 * own scope (.portal-shell / .feed-provider-v1 / .partner-dash) since each has
 * its own design-token namespace -- this component only renders structure. */
export function WorkspaceSwitcher({ current, others }: { current: PanelLink; others: PanelLink[] }) {
  const [open, setOpen] = useState(false);

  if (others.length === 0) return null;

  return (
    <div className="ws-group">
      <button type="button" className="ws-card ws-trigger" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="ws-trigger-top">
          <span className="ws-eyebrow">Workspace</span>
          <ChevronDown size={15} strokeWidth={2} className={`ws-caret${open ? " open" : ""}`} aria-hidden="true" />
        </div>
        <div className="ws-row">
          <span className="ws-dot" aria-hidden="true" />
          <span className="ws-name">{current.label}</span>
        </div>
        <span className="ws-domain">{PANEL_HOST[current.key]}</span>
      </button>
      {open && (
        <div className="ws-card ws-list" role="group" aria-label="Switch workspace">
          {others.map((panel) => (
            <a key={panel.key} className="ws-list-link" href={panel.href}>
              <span className="ws-dot" aria-hidden="true" />
              <span className="ws-list-text">
                <span className="ws-name">{panel.label}</span>
                <span className="ws-domain">{PANEL_HOST[panel.key]}</span>
              </span>
              <span className="ws-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
