"use client";

import { usePathname } from "next/navigation";
import type { AdminSurface } from "./sidebar";

const TITLES: Record<string, { title: string; crumb: string }> = {
  "/dashboard": { title: "Dashboard", crumb: "dashboard" },
  "/downloads": { title: "Downloads", crumb: "downloads" },
  "/education": { title: "Education", crumb: "education" },
  "/account": { title: "Account", crumb: "account" },
  "/admin": { title: "Admin", crumb: "admin" },
  "/admin/users": { title: "Users", crumb: "admin / users" },
  "/admin/licenses": { title: "Licenses", crumb: "admin / licenses" },
  "/admin/downloads": { title: "Downloads", crumb: "admin / downloads" },
  "/admin/history": { title: "History", crumb: "admin / history" },
};

function resolveTitle(pathname: string): { title: string; crumb: string } {
  if (TITLES[pathname]) return TITLES[pathname];
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "dashboard";
  const title = last
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return { title, crumb: segments.join(" / ") };
}

export function PortalTopbar({
  isAdmin,
  adminSurface = "portal",
  onBurgerClick,
}: {
  isAdmin: boolean;
  adminSurface?: AdminSurface;
  onBurgerClick: () => void;
}) {
  const pathname = usePathname();
  const { title, crumb } = resolveTitle(pathname);
  const host = adminSurface === "feed" ? "feed.horizonhft.com" : "portal.horizonhft.com";

  return (
    <header className="topbar">
      <button type="button" className="burger" onClick={onBurgerClick} aria-label="Toggle navigation">
        ☰
      </button>
      <div>
        <h1>{title}</h1>
        <div className="crumb">{host} / {crumb}</div>
      </div>
      <div className="sp" />
      {isAdmin && <span className="adminchip">🛡 Admin mode</span>}
      <div className="tconn">
        <span className="d" /> Live
      </div>
    </header>
  );
}
