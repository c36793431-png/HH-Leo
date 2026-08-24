// Feed provider health -- placeholder only (Iris's spec §10, bus thread
// feed-admin-dashboard-build-2026-08-24). No collector exists yet, so this page renders NO
// invented state: no uptime numbers, no latency figures, no status lights/badges. The nav
// pill's "Soon" styling in sidebar.tsx is untouched -- this route exists so the link resolves,
// not because health is live.
export default function AdminFeedHealthPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Feed health
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Feed health</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Not yet instrumented — no provider feed collector is wired up. This page will show
          per-provider uptime and connection status once one lands.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-hidden="true">
        {["Connection status", "Uptime (30d)", "Latency"].map((label) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-700/50 bg-zinc-900/40 p-4 opacity-40"
          >
            <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
            <div className="mt-2 h-6 w-16 rounded bg-zinc-700/60" />
            <div className="mt-3 h-2 w-full rounded bg-zinc-800" />
            <div className="mt-1.5 h-2 w-2/3 rounded bg-zinc-800" />
          </div>
        ))}
      </section>
    </div>
  );
}
