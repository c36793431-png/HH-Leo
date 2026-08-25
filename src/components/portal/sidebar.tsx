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
  Wrench,
  HardDrive,
  CircleUser,
  CandlestickChart,
  DollarSign,
  Award,
  UserSquare2,
  Upload,
  ClipboardList,
  History,
  Radar,
  SatelliteDish,
  Handshake,
  UserPlus,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";

export type PortalTier = "free" | "trial" | "paid" | "team" | "admin";

// Ship date for the "NEW" pill on Trading — shown for 30 days from wave-BB colored-sidebar launch.
// Computed at module scope (not render) so it stays a pure value for the component body.
const TRADING_IS_NEW = Date.now() < new Date("2026-09-12T00:00:00Z").getTime();

const PORTAL_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, color: "#34D17A" },
  { href: "/downloads", label: "Downloads", icon: Download, paidOnly: true, color: "#7BE06A" },
  { href: "/community", label: "Community", icon: Users, color: "#2DE2E6" },
  { href: "/feeds", label: "Feeds", icon: Rss, paidOnly: true, lockedStaysOnPage: true, color: "#17D0B0" },
  { href: "/alerts", label: "Trading", icon: CandlestickChart, paidOnly: true, lockedStaysOnPage: true, color: "#FFC24B", isNew: true },
  { href: "/strategies", label: "Strategies", icon: Zap, paidOnly: true, lockedStaysOnPage: true, color: "#37F5A0" },
  { href: "/setfiles", label: "Setfiles", icon: Sliders, paidOnly: true, lockedStaysOnPage: true, color: "#2FBE8E" },
  { href: "/education", label: "Education", icon: GraduationCap, color: "#38BDF8" },
  { href: "/education/advanced", label: "Advanced Education", icon: BookMarked, paidOnly: true, lockedStaysOnPage: true, color: "#5B8DEF" },
  { href: "/vps", label: "VPS", icon: Server, color: "#14B8A6" },
  { href: "/careers", label: "Careers", icon: Briefcase, color: "#7C9CB8" },
  { href: "/brokers", label: "Brokers", icon: Building2, paidOnly: true, lockedStaysOnPage: true, color: "#6E8FC7" },
  { href: "/prop-firm", label: "Prop Firm", icon: TrendingUp, paidOnly: true, lockedStaysOnPage: true, color: "#8A86D6" },
  { href: "/account/refer", label: "Refer & earn", icon: Gift, color: "#F0A94B" },
  { href: "/account/my-setup", label: "My setup", icon: Wrench, paidOnly: true, lockedStaysOnPage: true, color: "#5FC8BE" },
  { href: "/account/servers", label: "Servers", icon: HardDrive, paidOnly: true, lockedStaysOnPage: true, color: "#189FC9" },
  { href: "/account", label: "Account", icon: CircleUser, color: "#6FB0D8" },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon; color: string; paidOnly?: boolean; lockedStaysOnPage?: boolean; isNew?: boolean }[];

// portal.horizonhft.com/admin/* — everything except provider-applications, which moved
// to the feed-admin surface below (decision_split_portal_admin_and_feed_admin_surfaces_2026-08-23).
const PORTAL_ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/finance", label: "Finance", icon: DollarSign },
  { href: "/admin/referrals", label: "Referrals", icon: Award },
  { href: "/admin/partners", label: "Partners", icon: Handshake },
  { href: "/admin/partner-applications", label: "Partner applications", icon: UserPlus },
  { href: "/admin/users", label: "Users", icon: UserSquare2 },
  { href: "/admin/connections", label: "Connections", icon: Radar },
  { href: "/admin/setups", label: "Setups", icon: Settings },
  { href: "/admin/setfiles", label: "Setfiles", icon: Sliders },
  { href: "/admin/licenses", label: "Licenses", icon: Server },
  { href: "/admin/downloads", label: "Publish builds", icon: Upload },
  { href: "/admin/applications", label: "Applications", icon: ClipboardList },
  { href: "/admin/feed-requests", label: "Feed requests", icon: Rss },
  { href: "/admin/feed-tier-requests", label: "Feed signups", icon: SatelliteDish },
  { href: "/admin/feed-tier-trials", label: "Feed trials", icon: Gift },
  { href: "/admin/black-trials", label: "Black trials", icon: SatelliteDish },
  { href: "/admin/strategy-requests", label: "Strategy requests", icon: Zap },
  { href: "/admin/strategy-submissions", label: "Strategy submissions", icon: BookMarked },
  { href: "/admin/history", label: "History", icon: History },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon }[];

// feed.horizonhft.com/admin/* — feed-ops surface. "Feed health" stays a visible-but-disabled
// placeholder (no collector wired yet, spec §10); Providers and Revenue are live routes.
// Order matches feed-admin-dashboard-spec.md §2.
const FEED_ADMIN_LINKS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/provider-applications", label: "Provider applications", icon: ClipboardCheck },
  { href: "/admin/providers", label: "Providers", icon: SatelliteDish },
  { href: "/admin/register-provider", label: "Register provider", icon: UserPlus },
  { href: "/admin/revenue", label: "Revenue", icon: DollarSign },
  { href: "/admin/feed-health", label: "Feed health", icon: Radar, soon: true },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon; soon?: boolean }[];

// §2's "PLATFORM → Accounts" row: the mockup carries it as a placeholder (href="#", no
// page behind it anywhere in this app) same as Feed health was before its tab existed —
// so it renders "soon" rather than link to a route that doesn't exist yet.
const FEED_PLATFORM_LINKS = [
  { href: "/admin/accounts", label: "Accounts", icon: CircleUser, soon: true },
] as const satisfies readonly { href: string; label: string; icon: LucideIcon; soon?: boolean }[];

function isActive(pathname: string, href: string): boolean {
  const [path] = href.split("#");
  if (path === "/dashboard" || path === "/account" || path === "/admin") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

export type AdminSurface = "portal" | "feed";

export function PortalSidebar({
  tier,
  isAdmin,
  userName,
  userEmail,
  adminSurface = "portal",
  pendingApplicationsCount = 0,
}: {
  tier: PortalTier;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
  adminSurface?: AdminSurface;
  /** Single §6 selector value — both this badge and the dashboard tile read the same
   * getProviderApplicationStats().pendingCount; neither hardcodes or recomputes it. */
  pendingApplicationsCount?: number;
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
          <small>{adminSurface === "feed" ? "HFT · FEED NETWORK" : "HFT PORTAL"}</small>
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
              const isNew = "isNew" in link && link.isNew && TRADING_IS_NEW;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={locked && !lockedStaysOnPage ? "/dashboard#downloads" : link.href}
                  className={locked ? "locked" : active ? "on" : undefined}
                  style={{ "--item-color": link.color } as React.CSSProperties}
                >
                  <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                  {isNew && <span className="pill new">New</span>}
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
              <span className="shield">🛡</span> {adminSurface === "feed" ? "Feed admin" : "Admin"}
            </div>
            {(adminSurface === "feed" ? FEED_ADMIN_LINKS : PORTAL_ADMIN_LINKS).map((link) => {
              const Icon = link.icon;
              const soon = "soon" in link && link.soon;
              const badgeCount = link.href === "/admin/provider-applications" ? pendingApplicationsCount : 0;
              if (soon) {
                return (
                  <span key={link.href} className="soon" aria-disabled="true">
                    <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                    <span className="pill soon-pill">Soon</span>
                  </span>
                );
              }
              return (
                <Link key={link.href} href={link.href} className={isActive(pathname, link.href) ? "on" : undefined}>
                  <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                  {badgeCount > 0 && <span className="pill">{badgeCount}</span>}
                </Link>
              );
            })}

            {adminSurface === "feed" && (
              <>
                <div className="grp">Platform</div>
                {FEED_PLATFORM_LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <span key={link.href} className="soon" aria-disabled="true">
                      <span className="ic"><Icon size={18} strokeWidth={1.75} /></span> {link.label}
                      <span className="pill soon-pill">Soon</span>
                    </span>
                  );
                })}
              </>
            )}
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
