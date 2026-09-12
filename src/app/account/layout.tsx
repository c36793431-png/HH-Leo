import { ToastHost } from "@/components/admin/toast-host";

/** Same defect /feeds had (1f5662a): the /account subtree had no layout at all, so
 * emitToast() calls from its client flows had no subscriber and were discarded silently.
 * toast-bus.ts is a plain in-memory listener Set: an emit with zero listeners is a no-op
 * with no console error, so the only thing that makes a toast visible is a mounted
 * ToastHost on the route.
 *
 * Mounted at /account rather than per-route (03566c5 scoped it to /account/servers) because
 * /account/my-setup has the same defect via config-summary-form.tsx ("Paste parsed",
 * "Config summary saved"/savedMessage, "Config summary cleared", errors). One host here
 * covers all four routes in the subtree -- servers (server-registration-form.tsx,
 * black-trial-card.tsx), my-setup (config-summary-form.tsx), and /account and
 * /account/refer, which import no emitter today but get a host for free if one lands.
 * servers/layout.tsx is deleted in the same commit: a nested pair would mount two hosts
 * and render every toast on /account/servers twice.
 *
 * Mount only -- no auth gate. All four pages redirect to /login themselves
 * (page.tsx:16, refer:25, my-setup:15, servers:101) and render their own PortalShell, so
 * this layout adds no chrome and no second gate. Placement mirrors feeds/layout.tsx and
 * feed/dashboard/layout.tsx: ToastHost last, a sibling after the page content. A fragment
 * rather than a wrapper div, since there is no shell at this level. ToastHost is
 * position:fixed, so tree position doesn't affect where it renders. */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  );
}
