"use client";

import { useEffect, useState } from "react";
import {
  MEMBER_SUCCESS_FOOTNOTE,
  MEMBER_SUCCESS_HEADING,
  MEMBER_SUCCESS_LABEL,
  MEMBER_SUCCESS_STORIES,
} from "@/lib/member-success-stories";

const AUTOPLAY_MS = 5000;

/**
 * The terminal page's Member Success Stories, at the end of the page (coxwell via marcus, m59186).
 *
 * AUTOPLAY like the live homepage (marcus m59418): a slide every 5 s, paused while the pointer or
 * keyboard focus is inside, stopped for good after any click in it, and never started under
 * prefers-reduced-motion (checked after mount, so the server render and a reduced-motion visitor
 * both get a still carousel).
 *
 * Every slide is in the server HTML, so the text is there without script. The track slides by
 * transform; the slides off screen are inert, so Tab and screen readers skip them.
 */
export function MemberSuccessStories() {
  const n = MEMBER_SUCCESS_STORIES.length;
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const playing = !stopped && !paused && !reducedMotion;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % n), AUTOPLAY_MS);
    return () => clearInterval(t);
  }, [playing, n]);

  return (
    <section className="card mkd-stories" aria-labelledby="mkd-stories-head">
      <h2 id="mkd-stories-head" className="mkd-section-head">
        {MEMBER_SUCCESS_HEADING}
      </h2>
      <div
        className="mkd-stories-frame"
        role="region"
        aria-roledescription="carousel"
        aria-label={MEMBER_SUCCESS_HEADING}
        onClickCapture={() => setStopped(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        <div className="mkd-stories-viewport" aria-live={playing ? "off" : "polite"}>
          <ul className="mkd-stories-track" style={{ transform: `translateX(-${index * 100}%)` }}>
            {MEMBER_SUCCESS_STORIES.map((s, i) => (
              <li
                key={s.id}
                className="mkd-story"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${n}`}
                aria-hidden={i !== index}
                inert={i !== index}
              >
                <div className="mkd-story-media">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.image.src}
                    alt={s.image.alt}
                    width={s.image.width}
                    height={s.image.height}
                    loading={i === 0 ? "eager" : "lazy"}
                  />
                </div>
                <div className="mkd-story-text">
                  <div className="mkd-story-label">{MEMBER_SUCCESS_LABEL}</div>
                  <h3 className="mkd-story-title">{s.title}</h3>
                  <div className="mkd-story-subtitle">{s.subtitle}</div>
                  <p className="mkd-story-desc">{s.description}</p>
                  <ul className="mkd-story-tags">
                    {s.tags.map((t) => (
                      <li key={t}>#{t}</li>
                    ))}
                  </ul>
                  <div className="mkd-story-date">{s.date}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="mkd-stories-controls">
          <button
            type="button"
            className="mkd-stories-arrow"
            aria-label="Previous story"
            onClick={() => setIndex((i) => (i - 1 + n) % n)}
          >
            ‹
          </button>
          <div className="mkd-stories-dots">
            {MEMBER_SUCCESS_STORIES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="mkd-stories-dot"
                aria-label={`Story ${i + 1} of ${n}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className="mkd-stories-arrow"
            aria-label="Next story"
            onClick={() => setIndex((i) => (i + 1) % n)}
          >
            ›
          </button>
        </div>
      </div>
      <p className="mkd-stories-foot">{MEMBER_SUCCESS_FOOTNOTE}</p>
    </section>
  );
}
