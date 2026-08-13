"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Download,
  Users,
  Rss,
  Zap,
  Sliders,
  GraduationCap,
  BookMarked,
  Server,
  Briefcase,
  Building2,
  TrendingUp,
  Gift,
  Settings,
  CircleUser,
  DollarSign,
  Award,
  UserSquare2,
  Upload,
  ClipboardList,
  History,
  Radar,
  type LucideIcon,
} from "lucide-react";

export type PortalTier = "free" | "trial" | "paid" | "team" | "admin";

const PORTAL_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/downloads", label: "Downloads", icon: Download, paidOnly: true },
  { href: "/community", label: "Community", icon: Users },
  { href: "/feeds", label: "Feeds", icon: Rss, paidOnly: true, lockedStaysOnPage: true },
  { href: "/strategies", label: "Strategies", icon: Zap, paidOnly: true, lockedStaysOnPage: true },
  { href: "/setfiles", label: "Setfiles", icon: Sliders, paidOnly: true, lockedStaysOnPage: true },
  { href: "/education", label: "Education", icon: GraduationCap },
  { href: "/education/advanced", label: "Advanced Education", icon: BookMarked, paidOnly: true, lockedStaysOnPage: true },
  { href: "/vps", label: "VPS", icon: Server },
  { href: "/careers", label: "Careers", icon: Briefcase },
  { href: "/brokers", label: "Brokers", icon: Building2, paidOnly: true, lockedStaysOnPage: true },
  { href: "/prop-firm", label: "Prop Firm", icon: TrendingUp, paidOnly: true, lockedStaysOnPage: true },
  { href: "/account/refer", label: "Refer & earn", icon: Gift },
  { href: "/account/my-setup", label: "My setup", icon: Settings, paidOnly: true, lockedStaysOnPage: true },
  { href: "/account/servers", label: "Servers", icon: Server, paidOnly: true, lockedStaysOnPage: true },
  { href: "/account", label: "Account", icon: CircleUser },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon; paidOnly?: boolean; lockedStaysOnPage?: boolean }[];

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/finance", label: "Finance", icon: DollarSign },
  { href: "/admin/referrals", label: "Referrals", icon: Award },
  { href: "/admin/users", label: "Users", icon: UserSquare2 },
  { href: "/admin/connections", label: "Connections", icon: Radar },
  { href: "/admin/setups", label: "Setups", icon: Settings },
  { href: "/admin/setfiles", label: "Setfiles", icon: Sliders },
  { href: "/admin/licenses", label: "Licenses", icon: Server },
  { href: "/admin/downloads", label: "Publish builds", icon: Upload },
  { href: "/admin/applications", label: "Applications", icon: ClipboardList },
  { href: "/admin/feed-requests", label: "Feed requests", icon: Rss },
  { href: "/admin/strategy-requests", label: "Strategy requests", icon: Zap },
  { href: "/admin/history", label: "History", icon: History },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon }[];

function isActive(pathname: string, href: string): boolean {
  const [path] = href.split("#");
  if (path === "/dashboard" || path === "/account") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function PortalSidebar({
  tier,
  isAdmin,
  userName,
  userEmail,
}: {
  tier: PortalTier;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
}) {
  const pathname = usePathname();
  const initial = (userName.trim()[0] ?? "?").toUpperCase();
  const tierLabel = tier === "admin" ? "Admin" : tier === "team" ? "Team" : tier === "trial" ? "Trial" : tier === "paid" ? "Active" : "Free";
  const tierClass = tier === "free" ? "" : tier;

  // "deal" licenses fold into "paid" upstream (see computePortalTier), so this covers
  // the full paid+/team/deal/admin set the sidebar theming applies to.
  const isPaidPlus = tier === "paid" || tier === "team" || tier === "admin";

  // Paid/trial/team/admin get the blue+cyan+gold-apex mark; free gets the green tri-triangle.
  // Falls back to the free asset if the paid asset isn't deployed yet.
  const [paidLogoFailed, setPaidLogoFailed] = useState(false);
  const showPaidLogo = tier !== "free" && !paidLogoFailed;
  const logoSrc = showPaidLogo ? "/brand/horizon-logo-paid.png" : "/brand/horizon-logo-free.png";

  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="Horizon HFT dashboard">
        <Image
          src={logoSrc}
          alt="Horizon"
          width={38}
          height={38}
          className="glyph-img"
          priority
          onError={() => setPaidLogoFailed(true)}
        />
        <div className="txt">
          HORIZON
          <small>HFT PORTAL</small>
          <span className={`brand-pill${tierClass ? ` ${tierClass}` : ""}`}>{tierLabel.toUpperCase()}</span>
        </div>
      </Link>
      <nav className={`nav${isPaidPlus ? " paid-theme" : ""}`}>
        {!isAdmin && (
          <>
            <div className="grp">Portal</div>
            {PORTAL_LINKS.map((link) => {
              const paidOnly = "paidOnly" in link && link.paidOnly;
              const locked = paidOnly && tier === "free";
              const unlocked = paidOnly && isPaidPlus;
              const lockedStaysOnPage = "lockedStaysOnPage" in link && link.lockedStaysOnPage;
              const active = isActive(pathname, link.href);
              const isEdu = link.href === "/education";
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={locked && !lockedStaysOnPage ? "/dashboard#downloads" : link.href}
                  className={locked ? "locked" : active ? (isEdu ? "on edu" : "on") : undefined}
                >
                  <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                  {locked && <span className="lock">🔒</span>}
                  {unlocked && <span className="crown" aria-label="Included in your plan">👑</span>}
                </Link>
              );
            })}
          </>
        )}

        {isAdmin && (
          <div className="admin-block">
            <div className="grp">
              <span className="shield">🛡</span> Admin
            </div>
            {ADMIN_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <Link key={link.href} href={link.href} className={isActive(pathname, link.href) ? "on" : undefined}>
                  <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                </Link>
              );
            })}
          </div>
        )}
      </nav>
      <div className="side-foot">
        <Link href="/account" className={`acct${tierClass ? ` ${tierClass}-acct` : ""}`}>
          <div className="av">{initial}</div>
          <div className="who">
            <b>{userName}</b>
            <span>{userEmail}</span>
          </div>
          <span className={`tier ${tierClass}`}>{tierLabel}</span>
        </Link>
      </div>
    </aside>
  );
}
