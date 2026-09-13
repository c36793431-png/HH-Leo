/** Shared read-only field vocabulary for admin detail surfaces -- lifted out of
 * admin/provider-applications/[id]/page.tsx so /admin/providers' roster Connection block renders
 * in the same visual language instead of growing a second dialect (marcus, thread
 * leo-provider-self-registration-scope-2026-09-10: "reusing the existing Section/Field/ChipField
 * vocabulary"). `Section` deliberately stayed on the detail page: it carries that page's numbered
 * section chrome and a 2-col grid, neither of which belongs inside a table row.
 *
 * Visually identical to what the detail page already shipped when `note` is omitted, which is
 * every call site on that page.
 *
 * `note` exists for exactly one reason. The roster shows values captured at two different grains
 * side by side -- per-tier on provider_tiers, per-application on provider_applications -- and an
 * application-wide value rendered as if it were per-tier is a wrong claim that looks right. The
 * schema preserves that distinction; the UI is not allowed to erase it. */

function FieldLabel({ label, note }: { label: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {note && (
        <span className="rounded border border-amber-700/40 bg-amber-950/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-400/90">
          {note}
        </span>
      )}
    </div>
  );
}

export function Field({
  label,
  value,
  href,
  note,
}: {
  label: string;
  value: string | null;
  href?: string;
  note?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} note={note} />
      <div className="mt-0.5 text-sm text-zinc-200">
        {value ? (
          href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-teal-400 hover:underline">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}

/** Renders an already-structured multi-value field as chip pills. Takes the values as an array
 * rather than a delimited string on purpose: the only callers that legitimately have chips are
 * ones whose data is genuinely multi-value at the source (provider_tiers.regions/coverage are
 * text[] per 0083). Anything that needs splitting must do the splitting at its own call site and
 * own that decision -- see ChipField on the provider-applications detail page, which splits a
 * string this codebase normalized on the way in. Free text from an un-normalized source is
 * displayed as free text, never split (marcus, m47740). */
export function ChipList({ label, chips, note }: { label: string; chips: string[]; note?: string }) {
  return (
    <div>
      <FieldLabel label={label} note={note} />
      <div className="mt-1 flex flex-wrap gap-1.5">
        {chips.length ? (
          chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-300"
            >
              {chip}
            </span>
          ))
        ) : (
          <span className="text-sm text-zinc-600">—</span>
        )}
      </div>
    </div>
  );
}
