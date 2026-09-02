"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LayoutDashboard, Handshake, Wallet, Users } from "lucide-react";
import { panelLink, type PanelLink } from "@/lib/user-roles";
import { WorkspaceSwitcher } from "@/components/shared/workspace-switcher";

// Stage 2 (bus thread partner-sidebar-stage2-2026-09-02, marcus): Earnings and Clients
// added -- both are a re-slice/group-by of data that already exists (deal_payments,
// partner_deals), no new storage. Referrals/Notifications/Account stay out; nothing has
// changed about those three since Stage 1 (see
// tmp_bus_reply_partner_sidebar_stage1_prework_2026-09-01.md for the original seven-item
// map).
const NAV = [
  { href: "/partner/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/partner/dashboard/deals", label: "Deals", icon: Handshake },
  { href: "/partner/dashboard/earnings", label: "Earnings", icon: Wallet },
  { href: "/partner/dashboard/clients", label: "Clients", icon: Users },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/partner/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function PartnerSidebar({
  partnerLabel,
  partnerEmail,
  isAdmin,
  otherPanels = [],
  signOutButton,
}: {
  partnerLabel: string;
  partnerEmail: string | null;
  isAdmin: boolean;
  /** Other panels this account can reach, from getOtherPanels(session.user.roles,
   * "partner") -- empty for the vast majority of accounts that hold only the partner role. */
  otherPanels?: PanelLink[];
  signOutButton: ReactNode;
}) {
  const pathname = usePathname();
  const initial = partnerLabel.trim().charAt(0).toUpperCase() || "P";

  return (
    <aside className="pd-sidebar">
      <Link href="/partner/dashboard" className="pd-brand" aria-label="Horizon HFT partner dashboard">
        <span className="glyph">
          <Image src="/brand/horizon-logo-partner.png" alt="Horizon HFT" width={38} height={38} priority />
        </span>
        <span className="txt">
          HORIZON
          <small>HFT · PARTNER PROGRAM</small>
        </span>
      </Link>
      <WorkspaceSwitcher current={panelLink("partner")} others={otherPanels} />
      <nav className="pd-side-nav">
        <div className="grp">Partner</div>
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} className={isActive(pathname, item.href) ? "on" : undefined} href={item.href}>
              <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="pd-side-foot">
        <div className="pd-side-acct">
          <div className="av">{initial}</div>
          <div className="who">
            <b>{partnerLabel}</b>
            <span>{partnerEmail ?? ""}</span>
          </div>
          <span className="tag">{isAdmin ? "Admin" : "Partner"}</span>
        </div>
        {signOutButton}
      </div>
    </aside>
  );
}
