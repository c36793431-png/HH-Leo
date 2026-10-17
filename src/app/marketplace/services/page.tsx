import Link from "next/link";
import { listListedConsultantProfiles, CONSULT_PROFILE_PATH } from "@/lib/consultant-profiles";
import { CONSULT_SERVICE_TYPES, CONSULT_SERVICE_TYPE_LABELS, serviceTypeFilter } from "@/lib/consult-service-types";
import { CONSULT_ORIGIN } from "@/lib/consult-host";
import { authPageHref } from "@/lib/post-auth-redirect";
import { MarketplaceFrame } from "@/components/marketplace/marketplace-frame";
import { ServiceTypeChips } from "@/components/marketplace/service-type-chips";

export const dynamic = "force-dynamic";

/**
 * /marketplace/services: the Consulting & Services category (consult S4; route marcus m71369 item 2). Approved service
 * providers who chose to show their profile: lib/consultant-profiles.ts listListedConsultantProfiles applies the one
 * gate (application approved and linked, published, not hidden). Humans only (Nova stays under Horizon AI). NO PRICES
 * and NO CONTACT DETAILS: the profile text is filtered on save (consult-public-text.ts) and clients ask through a
 * request. ?type= filters by service type; anything unknown shows everyone. Placeholder styling until Iris's design.
 */
export default async function MarketplaceServicesPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  const type = serviceTypeFilter((await searchParams).type);
  const profiles = await listListedConsultantProfiles(type);

  return (
    <MarketplaceFrame signInHref={authPageHref("/login", "/marketplace/services")}>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-xs text-zinc-500">
          <Link href="/marketplace" className="hover:text-zinc-300">Marketplace</Link>
          <span className="mx-1.5">/</span>Consulting &amp; Services
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-50">Consulting &amp; Services</h1>
        <p className="mt-2 text-sm text-zinc-400">
          People who help with Horizon: consulting, coding and development, setup and installation. Every provider is
          reviewed by Horizon before they appear here.
        </p>

        <ServiceTypeChips current={type} />

        {profiles.length === 0 ? (
          <p className="mt-8 rounded-xl border border-zinc-800 bg-black/30 p-6 text-sm text-zinc-400">
            {type ? `No providers offer ${CONSULT_SERVICE_TYPE_LABELS[type].toLowerCase()} yet.` : "No providers are listed yet."}
          </p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {profiles.map((p) => (
              <li key={p.slug}>
                <Link href={`${CONSULT_PROFILE_PATH}/${p.slug}`} className="block h-full rounded-xl border border-zinc-800 bg-black/30 p-5 hover:border-cyan-500/40">
                  <div className="text-base font-semibold text-zinc-100">{p.displayName}</div>
                  <div className="mt-1 text-sm text-zinc-300">{p.headline}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {CONSULT_SERVICE_TYPES.filter((t) => p.serviceTypes.includes(t)).map((t) => (
                      <span key={t} className="rounded-full border border-cyan-500/30 px-2 py-0.5 text-xs text-cyan-300">
                        {t === "other" && p.serviceOther ? p.serviceOther : CONSULT_SERVICE_TYPE_LABELS[t]}
                      </span>
                    ))}
                  </div>
                  {(p.platforms || p.markets) && (
                    <div className="mt-3 text-xs text-zinc-500">{[p.platforms, p.markets].filter(Boolean).join(" · ")}</div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-sm text-zinc-500">
          Offer your own services?{" "}
          <a href={CONSULT_ORIGIN} className="text-cyan-400 hover:text-cyan-300">Apply at consult.horizonhft.com</a>
        </p>
      </div>
    </MarketplaceFrame>
  );
}
