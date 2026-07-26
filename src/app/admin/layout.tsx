import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { AdminNav } from "@/components/admin-nav";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isAdminUsersPanelEmail(session.user.email)) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col sm:flex-row">
      <aside className="border-b border-zinc-800 px-4 py-4 sm:w-56 sm:shrink-0 sm:border-b-0 sm:border-r sm:px-4 sm:py-8">
        <div className="mb-4 flex items-center justify-between gap-3 sm:mb-8 sm:flex-col sm:items-start">
          <div className="flex items-center gap-3">
            <Logo size="nav" />
            <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Admin
            </span>
          </div>
          <div className="sm:hidden">
            <SignOutButton />
          </div>
        </div>
        <AdminNav />
        <div className="mt-8 hidden sm:block">
          <SignOutButton />
        </div>
      </aside>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
