import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminUsersPanelEmail(session.user.email)) redirect("/dashboard");

  const userName = session.user.name ?? session.user.email ?? "admin";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier="admin" isAdmin userName={userName} userEmail={userEmail}>
      {children}
    </PortalShell>
  );
}
