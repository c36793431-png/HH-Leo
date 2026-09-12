import { ToastHost } from "@/components/admin/toast-host";

/** Same defect /feeds had (1f5662a): the /account subtree has no layout at all, so the
 * emitToast() calls from the two client flows on this route --
 * server-registration-form.tsx ("Server registered" / "Server details updated" / errors)
 * and black-trial-card.tsx ("Black trial requested" / "Upgrade request sent." / errors) --
 * had no subscriber and were discarded silently. toast-bus.ts is a plain in-memory
 * listener Set: an emit with zero listeners is a no-op with no console error, so the only
 * thing that makes a toast visible is a mounted ToastHost on the route.
 *
 * Scoped to /account/servers, not /account, because those two components are imported
 * only by servers/page.tsx (:8, :14). /account/my-setup has the same invisible-toast
 * defect via config-summary-form.tsx -- reported separately, not fixed here.
 *
 * Mount only -- no auth gate. page.tsx already redirects to /login itself (:101) and
 * renders its own PortalShell (:153), so this layout adds no chrome and no second gate.
 * Placement mirrors feeds/layout.tsx and feed/dashboard/layout.tsx: ToastHost last, a
 * sibling after the page content. A fragment rather than a wrapper div, since there is no
 * shell at this level. ToastHost is position:fixed, so tree position doesn't affect where
 * it renders. */
export default function AccountServersLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  );
}
