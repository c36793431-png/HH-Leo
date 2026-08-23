import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ToastHost } from "@/components/admin/toast-host";

const FEED_HOST = "feed.horizonhft.com";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminUser(session.user)) redirect("/dashboard");

  const userName = session.user.name ?? session.user.email ?? "admin";
  const userEmail = session.user.email ?? "";

  // Same route file serves portal.horizonhft.com/admin/* and feed.horizonhft.com/admin/*
  // (see proxy.ts) — only the sidebar's nav list differs per host.
  const host = (await headers()).get("host") || "";
  const isFeedHost = host === FEED_HOST || host.startsWith(`${FEED_HOST}:`);

  return (
    <PortalShell tier="admin" isAdmin userName={userName} userEmail={userEmail} adminSurface={isFeedHost ? "feed" : "portal"}>
      {children}
      <ToastHost />
    </PortalShell>
  );
}
