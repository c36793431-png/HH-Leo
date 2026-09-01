"use client";

/** Mobile burger toggle for the partner-panel sidebar, ported from feed's
 * FeedNavToggle/FeedNavScrim (src/components/feed/feed-nav-toggle.tsx) -- same
 * body-class-flip approach since partner/dashboard/layout.tsx is an async server
 * component and can't hold the open/closed state itself. */
export function PartnerNavToggle() {
  return (
    <button
      type="button"
      className="pd-burger"
      aria-label="Toggle navigation"
      onClick={() => document.querySelector(".partner-dash")?.classList.toggle("nav-open")}
    >
      ☰
    </button>
  );
}

export function PartnerNavScrim() {
  return (
    <div
      className="pd-scrim"
      onClick={() => document.querySelector(".partner-dash")?.classList.remove("nav-open")}
    />
  );
}
