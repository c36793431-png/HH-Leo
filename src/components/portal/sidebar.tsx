"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type PortalTier = "free" | "paid" | "admin";

const PORTAL_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "▨" },
  { href: "/downloads", label: "Downloads", icon: "▤", paidOnly: true },
  { href: "/dashboard#community", label: "Community", icon: "◍" },
  { href: "/education", label: "Education", icon: "◈" },
  { href: "/account", label: "Account", icon: "◔" },
] as const;

const ADMIN_LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "◫" },
  { href: "/admin/finance", label: "Finance", icon: "$" },
  { href: "/admin/users", label: "Users", icon: "◱" },
  { href: "/admin/licenses", label: "Licenses", icon: "⬡" },
  { href: "/admin/downloads", label: "Publish builds", icon: "⇧" },
  { href: "/admin/history", label: "History", icon: "↻" },
] as const;

function isActive(pathname: string, href: string): boolean {
  const [path] = href.split("#");
  if (path === "/dashboard") return pathname === "/dashboard";
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
  const tierLabel = tier === "admin" ? "Admin" : tier === "paid" ? "Active" : "Free";
  const tierClass = tier === "admin" ? "admin" : tier === "paid" ? "paid" : "";

  // Paid/admin get the blue+cyan+gold-apex mark; free gets the green tri-triangle.
  // Falls back to the free asset if the paid asset isn't deployed yet.
  const [paidLogoFailed, setPaidLogoFailed] = useState(false);
  const showPaidLogo = (tier === "paid" || tier === "admin") && !paidLogoFailed;
  const logoSrc = showPaidLogo ? "/brand/horizon-logo-paid.png" : "/brand/horizon-logo-free.png";

  return (
    <aside className="sidebar">
      <div className="brand">
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
          {tier === "paid" && <span className="brand-pill paid">ACTIVE</span>}
          {tier === "admin" && <span className="brand-pill admin">ADMIN</span>}
        </div>
      </div>
      <nav className="nav">
        {!isAdmin && (
          <>
            <div className="grp">Portal</div>
            {PORTAL_LINKS.map((link) => {
              const locked = "paidOnly" in link && link.paidOnly && tier === "free";
              const active = isActive(pathname, link.href);
              const isEdu = link.href === "/education";
              return (
                <Link
                  key={link.href}
                  href={locked ? "/dashboard#downloads" : link.href}
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
