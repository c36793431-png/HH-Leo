"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BlogStripCard } from "@/lib/blog-feed";

/**
 * "From the blog" at the bottom of /feeds/<region>/tiers (coxwell via marcus, m60947).
 *
 * Not the member-stories carousel: that one shows a single slide, autoplays and has no swipe. This
 * strip is a native scroll-snap row, so touch screens swipe it with no script, and the arrows step
 * one card. No autoplay. Every card is in the server HTML; the arrows only scroll.
 */
export function TiersBlogStrip({ cards }: { cards: BlogStripCard[] }) {
  const rowRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    setAtStart(row.scrollLeft <= 1);
    setAtEnd(row.scrollLeft + row.clientWidth >= row.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    sync();
    row.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      row.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  const step = (dir: 1 | -1) => {
    const row = rowRef.current;
    const card = row?.firstElementChild as HTMLElement | null;
    if (!row || !card) return;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({ left: dir * (card.offsetWidth + gap), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <section className="card full tbs" aria-labelledby="tbs-head">
      <div className="tbs-head">
        <h3 id="tbs-head" className="fp-section-title">
          From the blog
        </h3>
        <div className="tbs-arrows">
          <button type="button" className="tbs-arrow" aria-label="Previous posts" disabled={atStart} onClick={() => step(-1)}>
            ‹
          </button>
          <button type="button" className="tbs-arrow" aria-label="More posts" disabled={atEnd} onClick={() => step(1)}>
            ›
          </button>
        </div>
      </div>
      <ul className="tbs-row" ref={rowRef}>
        {cards.map((c) => (
          <li key={c.link} className="tbs-card">
            <a href={c.link} className="tbs-link">
              <div className="tbs-cover">
                {c.image && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={c.image} alt="" width={1200} height={630} loading="lazy" />
                )}
              </div>
              <div className="tbs-body">
                <time className="tbs-date" dateTime={c.dateTime}>
                  {c.date}
                </time>
                <h4 className="tbs-title">{c.title}</h4>
                {c.excerpt && <p className="tbs-excerpt">{c.excerpt}</p>}
                <span className="tbs-read">Read on the blog →</span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
