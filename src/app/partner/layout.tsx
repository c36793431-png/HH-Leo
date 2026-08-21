/** Ungated wrapper shared by the public landing (page.tsx) and the auth-gated dashboard
 * (dashboard/*, which layers its own layout.tsx on top of this one). Kept standalone
 * instead of reworking the shared PortalShell sidebar, which is tier-driven for regular
 * user accounts and doesn't model a "partner" tier. */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}
