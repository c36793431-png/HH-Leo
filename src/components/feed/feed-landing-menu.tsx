"use client";

import { useRef, type ReactNode } from "react";

/** The feed landing's Menu sheet (m62857/m62859): a <details>, so it opens without JS, that also
 * closes when a link in it is tapped. "How we measure" is an in-page anchor, and without this the
 * open sheet would stay on top of the section it just scrolled to. Escape closes it too, and hands
 * focus back to the Menu button. */
export function FeedLandingMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      className="fl-burger"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !ref.current?.open) return;
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }}
    >
      <summary className="fl-menu">Menu</summary>
      <div
        className="fl-sheet"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a") && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
