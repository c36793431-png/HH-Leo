"use client";

import { useState } from "react";

/** Checkable review checklist for the provider-application detail rail -- visual/ephemeral only
 * (no backend field to persist against, per marcus's feed-admin-provider-applications-rebuild-
 * 2026-08-25 review: "make items checkable, not inert squares"). Resets on reload; this is a
 * reviewer's scratch pad, not a recorded decision. */
export function ReviewChecklist({ items }: { items: string[] }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <ul className="mt-2 flex flex-col gap-1.5 text-xs">
      {items.map((item, i) => (
        <li key={item}>
          <label className="flex cursor-pointer items-start gap-2 text-zinc-400 hover:text-zinc-300">
            <input
              type="checkbox"
              checked={checked.has(i)}
              onChange={() => toggle(i)}
              className="mt-0.5 h-3 w-3 rounded-sm border-zinc-600 bg-black/40 accent-teal-500"
            />
            <span className={checked.has(i) ? "text-zinc-500 line-through" : undefined}>{item}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
