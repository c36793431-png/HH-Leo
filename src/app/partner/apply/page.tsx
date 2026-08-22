import { PartnerApplyForm } from "@/components/partner/partner-apply-form";

interface RawSearchParams {
  status?: string;
}

/** Public partner-application page, reachable at partner.horizonhft.com/apply via
 * proxy.ts's existing "/partner" passthrough (this route lives under app/partner/) and at
 * portal.horizonhft.com/partner/apply directly -- no new proxy exception needed.
 *
 * Also doubles as the "you already applied" landing: partner/dashboard/layout.tsx redirects
 * a signed-in user with a pending application here with ?status=pending instead of building a
 * whole separate route (leo-partner-page-broken-auth-buttons-2026-08-22). */
export default async function PartnerApplyPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const pending = sp.status === "pending";
  const notAPartner = sp.status === "not-a-partner";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center text-zinc-100">
      <span className="text-sm font-semibold tracking-wide text-zinc-50">
        HORIZON<span className="text-cyan-400"> HFT</span>
      </span>
      <div className="max-w-lg space-y-3">
        <h1 className="text-2xl font-semibold">Become a Horizon HFT partner</h1>
        <p className="text-sm text-zinc-400">
          Refer traders to Horizon HFT and earn on every signup you bring in. Tell us a bit
          about yourself and we&rsquo;ll review your application.
        </p>
      </div>

      <div className="w-full max-w-lg">
        {notAPartner && (
          <div className="mb-6 rounded-lg border border-cyan-400/35 bg-cyan-950/20 px-6 py-4 text-center">
            <p className="text-sm text-zinc-100">
              You&rsquo;re logged in as a Horizon HFT member, but this area needs partner
              approval. Apply below to get started.
            </p>
          </div>
        )}
        {pending ? (
          <div className="rounded-lg border border-amber-400/35 bg-amber-950/20 px-6 py-8 text-center">
            <p className="text-sm text-zinc-100">
              Your partner application is under review — we&rsquo;ll be in touch soon.
            </p>
          </div>
        ) : (
          <PartnerApplyForm />
        )}
      </div>

      <a href="/login" className="text-sm text-zinc-400 hover:text-zinc-200 hover:underline">
        Already a partner? Log in
      </a>
    </div>
  );
}
