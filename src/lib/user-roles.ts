/** Shared source of truth for "which panels can this user reach", built on the
 * user_roles table (migration 0075). One computation, reused by both the
 * panel-switcher UI and anything that needs to know a user's full role set --
 * per marcus's user-roles-migration-2026-09-01 step 2 instruction, this must
 * not become two divergent implementations of the same fact. */

import { User, Handshake, SatelliteDish, Shield, type LucideIcon } from "lucide-react";

export type HorizonRole = "user" | "admin" | "partner" | "feed_provider";

// Priority order for picking the single "display" role (session.user.role) out
// of a user_roles row set -- highest-privilege/most-specific wins. Mirrors the
// vocabulary in users_role_check (0001, 0044, 0058).
const ROLE_PRIORITY: HorizonRole[] = ["admin", "partner", "feed_provider", "user"];

export function pickPrimaryRole(roles: readonly string[]): string {
  for (const candidate of ROLE_PRIORITY) {
    if (roles.includes(candidate)) return candidate;
  }
  return roles[0] ?? "user";
}

export type PanelKey = "portal" | "partner" | "feed" | "admin";

export const PANEL_HOST: Record<PanelKey, string> = {
  portal: "portal.horizonhft.com",
  partner: "partner.horizonhft.com",
  feed: "feed.horizonhft.com",
  admin: "portal.horizonhft.com",
};

// "Panel" -> "Portal" per coxwell's switcher-consistency ask (2026-09-01) -- role name stays
// the differentiator, "Member Portal" is left as-is pending his Member vs Horizon/User call.
const PANEL_LABEL: Record<PanelKey, string> = {
  portal: "Member Portal",
  partner: "Partner Portal",
  feed: "Feed Provider Portal",
  admin: "Admin Panel",
};

// Reads as the role, not the product -- matches the icon already used for that role elsewhere
// in the sidebar (Handshake on "Partners", SatelliteDish on "Providers").
const PANEL_ICON: Record<PanelKey, LucideIcon> = {
  portal: User,
  partner: Handshake,
  feed: SatelliteDish,
  admin: Shield,
};

const PANEL_PATH: Record<PanelKey, string> = {
  portal: "/dashboard",
  partner: "/partner/dashboard",
  feed: "/feed/dashboard",
  admin: "/admin/dashboard",
};

export type PanelLink = { key: PanelKey; label: string; href: string; icon: LucideIcon };

function panelLink(key: PanelKey): PanelLink {
  return {
    key,
    label: PANEL_LABEL[key],
    href: `https://${PANEL_HOST[key]}${PANEL_PATH[key]}`,
    icon: PANEL_ICON[key],
  };
}

/** Every panel this set of roles unlocks. Every signed-in user reaches the
 * member portal; admin/partner/feed_provider each unlock one more. Coxwell
 * reversed the prior admin exclusion (feed-admin-role-collision-fix-2026-08-24)
 * in user-roles-migration-2026-09-01 (m34248) -- admin now appears in this
 * switcher alongside partner/feed. PortalSidebar's separate host-switch
 * (feed.horizonhft.com/admin <-> portal.horizonhft.com/admin) is unaffected. */
export function getReachablePanels(roles: readonly string[] | null | undefined): PanelLink[] {
  const held = new Set(roles ?? []);
  const panels: PanelKey[] = ["portal"];
  if (held.has("admin")) panels.push("admin");
  if (held.has("partner")) panels.push("partner");
  if (held.has("feed_provider")) panels.push("feed");
  return panels.map(panelLink);
}

/** getReachablePanels filtered down to panels other than the one the caller is
 * already rendering -- what a switcher actually needs to link to. */
export function getOtherPanels(roles: readonly string[] | null | undefined, current: PanelKey): PanelLink[] {
  return getReachablePanels(roles).filter((p) => p.key !== current);
}
