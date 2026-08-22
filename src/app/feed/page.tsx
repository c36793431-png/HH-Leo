import { redirect } from "next/navigation";

/** No public landing screen was designed for feed.horizonhft.com (the 7 Iris mockups start
 * at the dashboard; per provider-panel-spec.md providers are admin-onboarded, not self-
 * signup like partner.horizonhft.com). /feed/dashboard/layout.tsx handles the auth gate. */
export default function FeedRootPage() {
  // Relative, not "/feed/dashboard" -- proxy.ts rewrites this path to /feed internally,
  // so a literal "/feed/dashboard" redirect would leak the internal /feed segment into
  // the URL bar (feed.horizonhft.com/feed/dashboard) instead of staying at /dashboard
  // (leo-feed-dashboard-redirect-loop-2026-08-22, item 3).
  redirect("/dashboard");
}
