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

// Segment-derived titles below capitalize each word — fine for plain words, wrong for acronyms
// ("vps" -> "Vps"). Only these two are known acronyms (thread multi-license-visibility-2026-08-31,
// marcus); other title/label mismatches on the portal are coxwell's naming calls, left alone.
const ACRONYM_WORDS = new Set(["vps", "obi"]);

// admin detail routes (e.g. /admin/users/[id]) end in a raw uuid — word-casing that segment
// produces "94529d89 Ae75 4df5 ..." (thread admin-user-detail-title-2026-09-01, marcus). The
// topbar only has the pathname to work with (it's rendered by admin/layout.tsx, above any
// per-page fetch), so the best generic fallback is the parent segment, singularized.
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleCaseSegment(segment: string): string {
  return segment
    .split("-")
    .map((word) => (ACRONYM_WORDS.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

// feed.horizonhft.com/admin is the feed-admin dashboard landing (spec §2), so its title
// reads "Dashboard" there even though the same path is plain "Admin" on the portal host.
function resolveTitle(pathname: string, adminSurface: AdminSurface): { title: string; crumb: string } {
  if (pathname === "/admin" && adminSurface === "feed") return { title: "Dashboard", crumb: "admin" };
  if (TITLES[pathname]) return TITLES[pathname];
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "dashboard";
  const crumb = segments.join(" / ");
  if (UUID_SEGMENT.test(last) && segments.length > 1) {
    const parentTitle = titleCaseSegment(segments[segments.length - 2]);
    const singular = parentTitle.endsWith("s") ? parentTitle.slice(0, -1) : parentTitle;
    return { title: `${singular} detail`, crumb };
  }
  return { title: titleCaseSegment(last), crumb };
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
  const { title, crumb } = resolveTitle(pathname, adminSurface);
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
