"use client";

/** Mobile burger toggle for the provider-panel sidebar (mockups/horizon-providers/_shell.css
 * used a `body.nav-open` class flip via inline onclick; ported as a client component toggling
 * the wrapper class instead since app/layout.tsx's <body> is shared across every route). */
export function FeedNavToggle() {
  return (
    <button
      className="fp-burger"
      onClick={() => document.querySelector(".feed-provider-v1")?.classList.toggle("nav-open")}
    >
      ☰
    </button>
  );
}

export function FeedNavScrim() {
  return (
    <div
      className="fp-scrim"
      onClick={() => document.querySelector(".feed-provider-v1")?.classList.remove("nav-open")}
    />
  );
}
