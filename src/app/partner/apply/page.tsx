import { redirect } from "next/navigation";

interface RawSearchParams {
  status?: string;
}

/** Retired standalone route -- the application form is now embedded directly on the
 * partner landing page (app/partner/page.tsx §4 Apply, partner-landing-v3 rebuild,
 * leo-partner-v3-mockup-2026-08-22). Forwards to the new #apply anchor, preserving
 * ?status= so the two redirect callers that still point here keep working:
 * dashboard/layout.tsx's "?status=pending" (signed-in user has a pending application)
 * and "?status=not-a-partner" (signed-in member, no application on file) -- both are
 * now read by page.tsx to render the same messaging inline instead of on this page. */
export default async function PartnerApplyPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const qs = sp.status ? `?status=${encodeURIComponent(sp.status)}` : "";
  redirect(`/partner${qs}#apply`);
}
