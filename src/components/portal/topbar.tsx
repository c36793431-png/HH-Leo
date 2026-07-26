"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, { title: string; crumb: string }> = {
  "/dashboard": { title: "Dashboard", crumb: "dashboard" },
  "/downloads": { title: "Downloads", crumb: "downloads" },
  "/account": { title: "Account", crumb: "account" },
  "/admin": { title: "Admin", crumb: "admin" },
  "/admin/users": { title: "Users", crumb: "admin / users" },
  "/admin/licenses": { title: "Licenses", crumb: "admin / licenses" },
  "/admin/history": { title: "History", crumb: "admin / history" },
};

function resolveTitle(pathname: string): { title: string; crumb: string } {
  if (TITLES[pathname]) return TITLES[pathname];
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "dashboard";
  return { title: last.charAt(0).toUpperCase() + last.slice(1), crumb: segments.join(" / ") };
}

export function PortalTopbar({ isAdmin, onBurgerClick }: { isAdmin: boolean; onBurgerClick: () => void }) {
  const pathname = usePathname();
  const { title, crumb } = resolveTitle(pathname);

  return (
    <header className="topbar">
      <button type="button" className="burger" onClick={onBurgerClick} aria-label="Toggle navigation">
        ☰
      </button>
      <div>
        <h1>{title}</h1>
        <div className="crumb">portal.horizonhft.com / {crumb}</div>
      </div>
      <div className="sp" />
      {isAdmin && <span className="adminchip">🛡 Admin mode</span>}
      <div className="tconn">
        <span className="d" /> Live
      </div>
    </header>
  );
}
