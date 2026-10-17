import Link from "next/link";
import { notFound } from "next/navigation";
import { getListedConsultantProfile } from "@/lib/consultant-profiles";
import { CONSULT_SERVICE_TYPES, CONSULT_SERVICE_TYPE_LABELS } from "@/lib/consult-service-types";
import { authPageHref } from "@/lib/post-auth-redirect";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getListedProfileRef } from "@/lib/consultant-profiles";
import { PROVIDER_REQUEST_LIMITS } from "@/lib/consult-provider-requests";
import { MarketplaceFrame } from "@/components/marketplace/marketplace-frame";
import { ProviderRequestForm } from "@/components/marketplace/provider-request-form";

export const dynamic = "force-dynamic";

/** Whether the signed-in viewer owns this profile (no request form to yourself) and has Telegram on file. */
async function viewerOf(userId: string, slug: string): Promise<{ isOwner: boolean; hasTelegram: boolean }> {
  const [ref, account] = await Promise.all([
    getListedProfileRef(slug),
    pool.query(`select telegram_username, telegram_user_id from users where id = $1`, [userId]),
  ]);
  const row = account.rows[0];
  return { isOwner: ref?.userId === userId, hasTelegram: row?.telegram_username != null || row?.telegram_user_id != null };
}

/**
 * /marketplace/services/<slug>: one listed service provider (consult S4). 404 unless the profile passes the listing
 * gate (getListedConsultantProfile: application approved and linked, published, not hidden), so a draft, a hidden or a
 * declined profile is indistinguishable from one that never existed. The text is shown as text, never as HTML. NO
 * PRICES, NO CONTACT DETAILS (filtered on save). Placeholder styling until Iris's design.
 */
export default async function MarketplaceServiceProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const profile = await getListedConsultantProfile((await params).slug);
  if (!profile) notFound();
  const signInHref = authPageHref("/login", "/marketplace/services");
  const session = await auth();
  const viewer = session?.user?.id ? await viewerOf(session.user.id, profile.slug) : null;

  const facts: [string, string][] = [
    ["Platforms", profile.platforms],
    ["Markets", profile.markets],
    ["Languages", profile.languages],
  ];

  return (
    <MarketplaceFrame signInHref={signInHref}>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-xs text-zinc-500">
          <Link href="/marketplace" className="hover:text-zinc-300">Marketplace</Link>
          <span className="mx-1.5">/</span>
          <Link href="/marketplace/services" className="hover:text-zinc-300">Consulting &amp; Services</Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-50">{profile.displayName}</h1>
        <p className="mt-1 text-base text-zinc-300">{profile.headline}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {CONSULT_SERVICE_TYPES.filter((t) => profile.serviceTypes.includes(t)).map((t) => (
            <span key={t} className="rounded-full border border-cyan-500/30 px-2 py-0.5 text-xs text-cyan-300">
              {t === "other" && profile.serviceOther ? profile.serviceOther : CONSULT_SERVICE_TYPE_LABELS[t]}
            </span>
          ))}
        </div>
        <div className="mt-6 whitespace-pre-wrap rounded-xl border border-zinc-800 bg-black/30 p-6 text-sm leading-relaxed text-zinc-300">
          {profile.about}
        </div>
        <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {facts.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-zinc-500">{k}</dt>
              <dd className="mt-0.5 text-zinc-300">{v}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-10 text-lg font-semibold text-zinc-100">Request this provider</h2>
        <div className="mt-3">
          {viewer ? (
            viewer.isOwner ? (
              <p className="text-sm text-zinc-400">This is your profile. Clients send their requests from here.</p>
            ) : (
              <ProviderRequestForm slug={profile.slug} askTelegram={!viewer.hasTelegram} limits={PROVIDER_REQUEST_LIMITS} />
            )
          ) : (
            <p className="text-sm text-zinc-400">
              <a href={signInHref} className="text-cyan-400 hover:text-cyan-300">Sign in</a> to send a request. Horizon passes it on.
            </p>
          )}
        </div>
        <p className="mt-8 text-xs text-zinc-500">
          Reviewed by Horizon before listing. Prices and contact details are not shown here; you reach a provider through
          a request on Horizon.
        </p>
      </div>
    </MarketplaceFrame>
  );
}
