import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { resolveConsultantAccount, type ConsultantAccountState } from "@/lib/consultant-applications";
import { CONSULT_APPLY_PATH, HORIZON_HUB_URL } from "@/lib/consult-host";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { Logo } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";

/** The service-provider dashboard, consult.horizonhft.com/dashboard (S2, marcus m71309). v1 = the application's status;
 * the profile editor joins it in S3. The account is the one the provider signs in with: lib/consultant-applications.ts
 * resolveConsultantAccount links an approved application only by an exact VERIFIED email. Admins have their own queue.
 * Placeholder styling until Iris's design lands (marcus m71303). */
export default async function ConsultDashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/consult-applications");

  const account = await resolveConsultantAccount(session.user.id);
  const email = session.user.email ?? null;

  return (
    <>
      <header className="flex items-center justify-between px-6 py-5">
        <Logo size="nav" href={HORIZON_HUB_URL} />
        <SignOutButton redirectTo="/" />
      </header>
      <main className="flex-1 px-4 pb-20 pt-6">
        <div className="mx-auto max-w-2xl">
          <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">SERVICE PROVIDERS</div>
          <h1 className="mt-2 text-3xl font-bold text-zinc-50">Your provider account</h1>
          {email && <p className="mt-2 text-sm text-zinc-500">Signed in as {email}</p>}
          <div className="mt-8 rounded-xl border border-zinc-800 bg-black/30 p-6">
            <AccountStatus account={account} />
          </div>
        </div>
      </main>
    </>
  );
}

function AccountStatus({ account }: { account: ConsultantAccountState }) {
  switch (account.state) {
    case "approved":
      return (
        <>
          <p className="text-sm font-medium text-emerald-300">Approved</p>
          <p className="mt-2 text-sm text-zinc-400">
            Your application was approved{account.decidedAt ? ` on ${formatAbsoluteUtc(account.decidedAt)}` : ""}. Your
            profile, which clients will see in the marketplace, is set up here next.
          </p>
        </>
      );
    case "pending":
      return (
        <>
          <p className="text-sm font-medium text-amber-300">In review</p>
          <p className="mt-2 text-sm text-zinc-400">
            We received your application on {formatAbsoluteUtc(account.createdAt)}. We review every application and reply
            by email.
          </p>
        </>
      );
    case "declined":
      return (
        <>
          <p className="text-sm font-medium text-zinc-300">Not approved</p>
          <p className="mt-2 text-sm text-zinc-400">
            We were not able to approve your application and emailed you about it. You can{" "}
            <a href={CONSULT_APPLY_PATH} className="text-cyan-400 hover:text-cyan-300">apply again</a>.
          </p>
        </>
      );
    case "unverified":
      return (
        <p className="text-sm text-zinc-400">
          To see your application, sign out and sign in with the email link, using the address you applied with.
        </p>
      );
    case "shared-email":
      return (
        <p className="text-sm text-zinc-400">
          More than one account uses this email, so we cannot show your application here. Contact support@horizonhft.com
          and we will sort it out.
        </p>
      );
    case "none":
      return (
        <p className="text-sm text-zinc-400">
          We found no application for this account.{" "}
          <a href={CONSULT_APPLY_PATH} className="text-cyan-400 hover:text-cyan-300">Apply to offer your services</a>{" "}
          with the email you sign in with.
        </p>
      );
  }
}
