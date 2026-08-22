/** Pass-through wrapper for everything under /feed -- mirrors src/app/partner/layout.tsx.
 * Real gating happens in feed/dashboard/layout.tsx; this just gives the route group a home. */
export default function FeedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
