"use client";

import { useState, type ReactNode } from "react";

/**
 * The /marketplace category filter row (Iris's design, via marcus 2026-09-16).
 *
 * THE CHIPS ARE NOT A LIST OF CATEGORIES — they are a list of the sections the page actually
 * rendered. The page derives them from the listings it is about to show, so a chip can never
 * select an empty result set, and a category that loses its last listing loses its chip in the
 * same pass. That is why this component takes sections rather than a category enum: the row and
 * the grid below it come from one array and cannot disagree.
 *
 * `All` is the default and is always first.
 */

const ALL = "all";

export interface MarketplaceSection {
  /** MarketplaceCategory key — the chip's identity and the section's render key. */
  key: string;
  /** Chip text. Comes from MARKETPLACE_CATEGORY_LABELS, never spelled again here. */
  label: string;
  /** The already-rendered section, passed down from the server page. */
  content: ReactNode;
}

/** A category that lives on its own page (Consulting & Services, consult S4): a plain link chip after the section chips.
 * The page passes one only while that page has something to show, the same rule as a section chip. */
export interface MarketplaceLinkChip {
  href: string;
  label: string;
}

export function MarketplaceCategoryFilter({ sections, links = [] }: { sections: MarketplaceSection[]; links?: MarketplaceLinkChip[] }) {
  const [active, setActive] = useState<string>(ALL);

  // A filter that can only say "All" and one other thing is furniture, not a filter: with one
  // section, `All` and that section select the identical page. Render the sections bare instead.
  if (sections.length < 2 && links.length === 0) return <>{sections.map((s) => s.content)}</>;

  // An unknown `active` cannot happen through the chips, but a section list that shrinks under a
  // selection can — fall back to showing everything rather than to a blank page.
  const shown = sections.filter((s) => s.key === active);
  const visible = shown.length > 0 ? shown : sections;

  return (
    <>
      <div className="mkt-chips" role="group" aria-label="Filter listings by category">
        <button
          type="button"
          className={active === ALL ? "chip on" : "chip"}
          aria-pressed={active === ALL}
          onClick={() => setActive(ALL)}
        >
          All
        </button>
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={active === section.key ? "chip on" : "chip"}
            aria-pressed={active === section.key}
            onClick={() => setActive(section.key)}
          >
            {section.label}
          </button>
        ))}
        {links.map((link) => (
          <a key={link.href} href={link.href} className="chip">
            {link.label}
          </a>
        ))}
      </div>

      {visible.map((section) => section.content)}
    </>
  );
}
