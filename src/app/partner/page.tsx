import { Logo } from "@/components/logo";

/** Public landing for partner.horizonhft.com's root — no pricing, per the affiliate-only
 * pricing policy (bus thread horizon-contact-for-pricing-swap-2026-08-21). Visiting this host
 * auto-attributes a referral cookie (see proxy.ts withPartnerRefCookie), so the signup CTA
 * here is what actually credits the partner once attributeReferralFromCookie runs. The
 * partner's own dashboard lives at /partner/dashboard, session-gated separately. */
export default function PartnerLandingPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center text-zinc-100">
      <Logo size="nav" />
      <div className="max-w-lg space-y-3">
        <h1 className="text-2xl font-semibold">You&rsquo;ve been invited to Horizon HFT</h1>
        <p className="text-sm text-zinc-400">
          Low-latency HFT signal feeds, license management, and a trading community — join free
          and see what&rsquo;s available once you&rsquo;re in.
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <a
          href="/signup"
          className="rounded-lg bg-cyan-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-400"
        >
          Create your account
        </a>
        <a href="/login" className="text-sm text-zinc-400 hover:text-zinc-200 hover:underline">
          Already have an account? Log in
        </a>
      </div>
      <a href="/partner/dashboard" className="text-xs text-zinc-600 hover:text-zinc-400 hover:underline">
        Partner login
      </a>
    </div>
  );
}
