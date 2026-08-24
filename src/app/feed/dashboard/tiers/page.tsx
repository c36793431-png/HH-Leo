import { redirect } from "next/navigation";

/** "My Tiers" nav entry removed (provider-side catalogue-assignment build is deferred,
 * not decided — coxwell 2026-08-24). Route kept alive as a redirect so stray
 * deep-links don't 500 mid-onboarding. */
export default function FeedMyTiersPage() {
  redirect("/feed/dashboard");
}
