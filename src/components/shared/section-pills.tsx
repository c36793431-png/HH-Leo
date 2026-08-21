"use client";

type SectionPill = { id: string; label: string };

export function SectionPills({ sections }: { sections: SectionPill[] }) {
  if (sections.length < 2) return null;

  return (
    <div className="sec-pills" role="navigation" aria-label="Jump to section">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="sec-pill"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          {s.label}
        </a>
      ))}
    </div>
  );
}
