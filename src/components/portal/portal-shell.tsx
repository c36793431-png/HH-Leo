"use client";

import { useState, type ReactNode } from "react";
import { PortalSidebar, type AdminSurface, type PortalTier } from "./sidebar";
import { PortalTopbar } from "./topbar";
import type { PanelLink } from "@/lib/user-roles";

export function PortalShell({
  tier,
  isAdmin,
  userName,
  userEmail,
  adminSurface,
  pendingApplicationsCount,
  hasOtherActiveTiers,
  switchablePanels,
  children,
}: {
  tier: PortalTier;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
  adminSurface?: AdminSurface;
  pendingApplicationsCount?: number;
  hasOtherActiveTiers?: boolean;
  switchablePanels?: PanelLink[];
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={`portal-shell${navOpen ? " nav-open" : ""}`}>
      <div className="scrim" onClick={() => setNavOpen(false)} />
      <div className="app">
        <PortalSidebar
          tier={tier}
          isAdmin={isAdmin}
          userName={userName}
          userEmail={userEmail}
          adminSurface={adminSurface}
          pendingApplicationsCount={pendingApplicationsCount}
          hasOtherActiveTiers={hasOtherActiveTiers}
          switchablePanels={switchablePanels}
        />
        <main className="main">
          <PortalTopbar isAdmin={isAdmin} adminSurface={adminSurface} onBurgerClick={() => setNavOpen((v) => !v)} />
          <section className="content">{children}</section>
        </main>
      </div>
    </div>
  );
}
