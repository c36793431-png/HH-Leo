import Link from "next/link";
import { CONSULT_SERVICE_TYPES, CONSULT_SERVICE_TYPE_LABELS, type ConsultServiceType } from "@/lib/consult-service-types";

/** The Consulting & Services type filter: plain links, so it works without JavaScript and every filter has its own URL. */
export function ServiceTypeChips({ current }: { current: ConsultServiceType | null }) {
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-cyan-400/60 bg-cyan-500/15 text-cyan-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"}`;
  return (
    <nav aria-label="Filter by service" className="mt-6 flex flex-wrap gap-2">
      <Link href="/marketplace/services" className={chip(current === null)} aria-current={current === null ? "page" : undefined}>All</Link>
      {CONSULT_SERVICE_TYPES.map((t) => (
        <Link key={t} href={`/marketplace/services?type=${t}`} className={chip(current === t)} aria-current={current === t ? "page" : undefined}>
          {CONSULT_SERVICE_TYPE_LABELS[t]}
        </Link>
      ))}
    </nav>
  );
}
