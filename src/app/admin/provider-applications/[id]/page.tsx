import Link from "next/link";
import { notFound } from "next/navigation";
import { getProviderApplication } from "@/lib/provider-applications";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";

const STATUS_BADGE_STYLES: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-950/20 text-amber-300",
  approved: "border-emerald-500/40 bg-emerald-950/20 text-emerald-300",
  declined: "border-red-500/40 bg-red-950/20 text-red-300",
};

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm text-zinc-200">{value || <span className="text-zinc-600">—</span>}</div>
    </div>
  );
}

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-zinc-200">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[11px] text-zinc-400">
          {num}
        </span>
        {title}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Read-only application detail view -- 4 sections mirroring feed-apply.html's form structure
 * (Company & contact / Your feed / What you'll offer / Anything else), per marcus's
 * feed-admin-provider-applications-rebuild-2026-08-25 manifest. This is intentionally not
 * register-provider: no editing, no tier/price fields -- approve/decline stays a row action
 * on the list, and approve navigates into register-provider separately. */
export default async function AdminProviderApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const application = await getProviderApplication(id);
  if (!application) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header>
        <Link href="/admin/provider-applications" className="text-xs text-zinc-500 hover:text-zinc-300 hover:underline">
          ← Provider applications
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-medium text-teal-400">{application.name}</h1>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE_STYLES[application.status]}`}
          >
            {application.status}
          </span>
          {application.source === "admin_manual" && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">Manual</span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Applied {formatAbsoluteUtc(application.appliedAt)} ({formatRelative(application.appliedAt)})
        </p>
      </header>

      {application.status !== "pending" && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
          <div className="text-zinc-300">
            {application.status === "approved" ? "Approved" : "Declined"} by {application.reviewedBy ?? "—"}
            {application.reviewedAt && ` · ${formatAbsoluteUtc(application.reviewedAt)}`}
          </div>
          {application.adminNotes && (
            <div className="mt-1 text-zinc-400">
              Note: <span className="text-zinc-300">{application.adminNotes}</span>
            </div>
          )}
          {application.status === "approved" && !application.onboardedAt && (
            <Link
              href={`/admin/register-provider?from_application=${application.id}`}
              className="mt-3 inline-block rounded bg-emerald-500 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-600"
            >
              Continue registration
            </Link>
          )}
        </section>
      )}

      <Section num={1} title="Company & contact">
        <Field label="Company / feed provider name" value={application.name} />
        <Field label="Primary contact email" value={application.email} />
        <Field label="Contact display name" value={application.contactName} />
        <Field label="Country / region" value={application.country} />
        <Field label="Timezone" value={application.timezone} />
        <Field label="Website / feed documentation URL" value={application.websiteUrl} />
      </Section>

      <Section num={2} title="Your feed">
        <Field label="Feed protocol(s)" value={application.protocol} />
        <Field label="Host endpoint" value={application.host} />
        <Field label="Port" value={application.port} />
        <Field label="CompID / stream id" value={application.compid} />
        <Field label="Regions" value={application.regions} />
      </Section>

      <Section num={3} title="What you'll offer">
        <Field label="Asset classes / instruments covered" value={application.coverage} />
        <Field label="Tiers offered" value={application.tiersOffered} />
      </Section>

      <Section num={4} title="Anything else">
        <Field label="Notes for our team" value={application.notes} />
      </Section>
    </div>
  );
}
