import type { IncludedLine, IncludedSection } from "@/lib/marketplace-catalogue";

/**
 * A product page's "What's included", laid out (coxwell via marcus, m58579 (a): "break the wall of
 * text"): a "cards" section is one card per line, a "ticks" section a two-column ticked grid, and
 * anything else the nested list the page has always drawn.
 *
 * NO WORD CHANGES. A card's title is its line up to the first " — " and its body the rest; a
 * tick's lead, up to the first ": " or " — ", is bold and the separator stays, so the tick reads
 * as the catalogue line letter for letter. A line with no separator is all title, or all lead.
 */
export function IncludedSections({ included }: { included: IncludedLine[] }) {
  return (
    <div className="card mkd-included-wide">
      <div className="mkd-plate-title">What&apos;s included</div>
      {included.map((entry) =>
        typeof entry === "string" ? (
          <p key={entry} className="mkd-included-line">
            {entry}
          </p>
        ) : (
          <Section key={entry.label} section={entry} />
        ),
      )}
    </div>
  );
}

function Section({ section }: { section: IncludedSection }) {
  return (
    <section className="mkd-section">
      <h2 className="mkd-section-head">
        {section.icon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="mkd-section-icon" src={section.icon} alt="" width={20} height={20} />
        )}
        {section.label}
      </h2>
      {section.layout === "cards" ? (
        <ul className="mkd-cards">
          {section.items.map((line) => {
            const [title, , body] = splitLead(line, [" — "]);
            return (
              <li key={line} className="mkd-card">
                <div className="mkd-card-title">{title}</div>
                {body && <p className="mkd-card-body">{body}</p>}
              </li>
            );
          })}
        </ul>
      ) : section.layout === "ticks" ? (
        <ul className="mkd-ticks">
          {section.items.map((line) => {
            const [lead, sep, rest] = splitLead(line, [": ", " — "]);
            return (
              <li key={line} className="mkd-tick">
                <span className="mkd-tick-mark" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <b>{lead}</b>
                  {sep}
                  {rest}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mkd-included">
          {section.items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** [lead, separator, rest] at the earliest of `seps`; [line, "", ""] when none occurs. */
function splitLead(line: string, seps: string[]): [string, string, string] {
  const hits = seps.map((sep) => [line.indexOf(sep), sep] as const).filter(([i]) => i > 0);
  if (hits.length === 0) return [line, "", ""];
  const [i, sep] = hits.reduce((a, b) => (b[0] < a[0] ? b : a));
  return [line.slice(0, i), sep, line.slice(i + sep.length)];
}
