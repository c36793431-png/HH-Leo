import { redirect } from "next/navigation";

/** No public landing screen was designed for feed.horizonhft.com (the 7 Iris mockups start
 * at the dashboard; per provider-panel-spec.md providers are admin-onboarded, not self-
 * signup like partner.horizonhft.com). /feed/dashboard/layout.tsx handles the auth gate. */
export default function FeedRootPage() {
  redirect("/feed/dashboard");
}
