"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { panelLink, type PanelLink } from "@/lib/user-roles";
import { WorkspaceSwitcher } from "@/components/shared/workspace-switcher";

const NAV = [
  { href: "/feed/dashboard", label: "Overview", ic: "▨" },
  { href: "/feed/dashboard/feeds", label: "Feeds", ic: "❖" },
  { href: "/feed/dashboard/users", label: "Users / Approvals", ic: "◉" },
  { href: "/feed/dashboard/accounts", label: "Accounts", ic: "◎" },
  { href: "/feed/dashboard/notifications", label: "Notifications", ic: "✦" },
  { href: "/feed/dashboard/revenue", label: "Revenue", ic: "▦" },
  { href: "/feed/dashboard/health", label: "Feed Health", ic: "◇" },
  { href: "/feed/dashboard/docs", label: "Docs / Integration", ic: "▤" },
] as const;

export function FeedSidebar({
  providerLabel,
  providerEmail,
  pendingCount,
  role,
  otherPanels = [],
  signOutButton,
}: {
  providerLabel: string;
  providerEmail: string | null;
  pendingCount: number;
  role: string;
  /** Other panels this account can reach (member portal / partner panel), from
   * getOtherPanels(session.user.roles, "feed") — empty for the vast majority
   * of accounts that hold only the feed_provider role. */
  otherPanels?: PanelLink[];
  signOutButton: ReactNode;
}) {
  const pathname = usePathname();
  const initial = providerLabel.trim().charAt(0).toUpperCase() || "P";

  return (
    <aside className="fp-sidebar">
      <div className="fp-brand">
        <Image src="/logo.png" alt="Horizon" width={38} height={38} className="glyph-img" priority />
        <div className="txt">
          HORIZON
          <small>PROVIDER PANEL</small>
        </div>
      </div>
      <WorkspaceSwitcher current={panelLink("feed")} others={otherPanels} />
      <nav className="fp-nav">
        <div className="grp">Provider</div>
        {NAV.map((item) => {
          const active = item.href === "/feed/dashboard" ? pathname === item.href : pathname?.startsWith(item.href);
          return (
            <Link key={item.href} className={active ? "on" : undefined} href={item.href}>
              <span className="ic">{item.ic}</span> {item.label}
              {item.href === "/feed/dashboard/users" && pendingCount > 0 && (
                <span className="pill">{pendingCount}</span>
              )}
            </Link>
          );
        })}
        <div className="grp">Settings</div>
        <span style={{ cursor: "default", opacity: 0.6 }}>
          <span className="ic">◔</span> Account <span style={{ fontSize: 10, marginLeft: "auto" }}>soon</span>
        </span>
      </nav>
      <div className="fp-side-foot">
        <div className="fp-acct">
          <div className="av">{initial}</div>
          <div className="who">
            <b>{providerLabel}</b>
            <span>{providerEmail ?? ""}</span>
          </div>
          <span className="tier">{role === "admin" ? "Admin" : "Provider"}</span>
        </div>
        {signOutButton}
      </div>
    </aside>
  );
}
