import Link from "next/link";
import { notFound } from "next/navigation";
import { getProviderApplication } from "@/lib/provider-applications";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { RegisterProviderForm } from "@/components/admin/register-provider-form";
import { registerProviderAction } from "./actions";

export default async function RegisterProviderPage({
  searchParams,
}: {
  searchParams: Promise<{ from_application?: string }>;
}) {
  const { from_application: applicationId } = await searchParams;
  if (!applicationId) notFound();

  const application = await getProviderApplication(applicationId);
  if (!application) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header>
        <Link href="/admin/provider-applications" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
          ← Back to Provider applications
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Admin · Register provider
          </span>
          {application.onboardedAt ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold tracking-wide text-emerald-300">
              LIVE
            </span>
          ) : (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-300">
              PENDING ONBOARDING
            </span>
          )}
        </div>
        <h1 className="mt-2 text-lg font-medium text-teal-400">{application.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Application submitted {formatAbsoluteUtc(application.appliedAt)}. Fields below are pre-filled from the
          application and editable before publishing.
        </p>
      </header>

      {application.status !== "approved" ? (
        <section className="rounded-xl border border-red-500/40 bg-red-950/40 p-6 text-sm text-red-300">
          This application is not approved yet (status: {application.status}). Approve it from the Provider
          applications queue before registering.
        </section>
      ) : (
        <RegisterProviderForm application={application} action={registerProviderAction} />
      )}
    </div>
  );
}
