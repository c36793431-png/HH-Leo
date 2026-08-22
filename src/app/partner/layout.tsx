/** Pass-through segment layout for everything under /partner. Used to be a shared
 * bg-zinc-950/max-w-5xl padded box for both the public landing (page.tsx) and the
 * auth-gated dashboard (dashboard/*) -- but the landing page (partner-landing-v3 rebuild,
 * leo-partner-v3-mockup-2026-08-22) needs a full-bleed sticky-nav layout of its own, so
 * that container moved into dashboard/layout.tsx (the only remaining consumer) instead.
 * Kept as a standalone file (rather than deleting) instead of reworking the shared
 * PortalShell sidebar, which is tier-driven for regular user accounts and doesn't model
 * a "partner" tier. */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
