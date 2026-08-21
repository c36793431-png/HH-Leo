import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";

/** Standalone gate — the shared PortalShell sidebar is tier-driven for regular
 * user accounts and doesn't model a "partner" tier; partners are a small, manually-onboarded
 * group, so this route tree stays self-contained instead of reworking that shared component. */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isPartnerUser(session.user) && !isAdminUser(session.user)) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-zinc-950 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">{children}</div>
    </div>
  );
}
