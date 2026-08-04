"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type PortalTier = "free" | "trial" | "paid" | "team" | "admin";

const PORTAL_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "▨" },
  { href: "/downloads", label: "Downloads", icon: "▤", paidOnly: true },
  { href: "/community", label: "Community", icon: "◍" },
  { href: "/education", label: "Education", icon: "◈" },
  { href: "/vps", label: "VPS", icon: "◎" },
  { href: "/careers", label: "Careers", icon: "▣" },
  { href: "/account/refer", label: "Refer & earn", icon: "$" },
  { href: "/account/my-setup", label: "My setup", icon: "⚙", paidOnly: true, lockedStaysOnPage: true },
  { href: "/account", label: "Account", icon: "◔" },
] as const;

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "◫" },
  { href: "/admin/finance", label: "Finance", icon: "$" },
  { href: "/admin/referrals", label: "Referrals", icon: "◈" },
  { href: "/admin/users", label: "Users", icon: "◱" },
  { href: "/admin/setups", label: "Setups", icon: "⚙" },
  { href: "/admin/licenses", label: "Licenses", icon: "⬡" },
  { href: "/admin/downloads", label: "Publish builds", icon: "⇧" },
  { href: "/admin/applications", label: "Applications", icon: "▣" },
  { href: "/admin/history", label: "History", icon: "↻" },
] as const;

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
      <nav className="nav">
        {!isAdmin && (
          <>
            <div className="grp">Portal</div>
            {PORTAL_LINKS.map((link) => {
              const locked = "paidOnly" in link && link.paidOnly && tier === "free";
              const lockedStaysOnPage = "lockedStaysOnPage" in link && link.lockedStaysOnPage;
              const active = isActive(pathname, link.href);
              const isEdu = link.href === "/education";
              return (
                <Link
                  key={link.href}
                  href={locked && !lockedStaysOnPage ? "/dashboard#downloads" : link.href}
                  className={locked ? "locked" : active ? (isEdu ? "on edu" : "on") : undefined}
                >
                  <span className="ic">{link.icon}</span> {link.label}
                  {locked && <span className="lock">🔒</span>}
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
            {ADMIN_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={isActive(pathname, link.href) ? "on" : undefined}>
                <span className="ic">{link.icon}</span> {link.label}
              </Link>
            ))}
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
