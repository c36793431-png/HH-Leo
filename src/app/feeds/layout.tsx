import { ToastHost } from "@/components/admin/toast-host";

/** The /feeds subtree had no layout at all, so emitToast() calls from the two live client
 * flows here -- feed-request-form.tsx (/feeds) and tier-request-control.tsx
 * (/feeds/[region]/tiers) -- had no subscriber and were discarded with no console error
 * (leo-feeds-toast-host-2026-09-11). toast-bus.ts is a plain in-memory listener Set: an
 * emit with zero listeners is a silent no-op, so the only thing that makes a toast visible
 * is a mounted ToastHost on that route.
 *
 * Mount only -- no auth gate here. Both pages under this segment already redirect to
 * /login themselves (page.tsx:36, [region]/tiers/page.tsx:116) and both render their own
 * PortalShell, so this layout deliberately adds no chrome and no second gate. Placement
 * mirrors feed/dashboard/layout.tsx: ToastHost last, a sibling after the page content
 * rather than inside it (marcus's call -- the closer analogue of the two existing mounts).
 * A fragment rather than a wrapper div, since there is no shell at this level to attach
 * one to. ToastHost is position:fixed, so tree position doesn't affect where it renders. */
export default function FeedsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  );
}
