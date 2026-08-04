import { listAllSetfiles } from "@/lib/setfiles";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { ActionButton } from "@/components/admin/action-button";
import { EditSetfileForm } from "@/components/admin/edit-setfile-form";
import {
  createSetfileAction,
  updateSetfileAction,
  toggleSetfileActiveAction,
  deleteSetfileAction,
  moveSetfileAction,
} from "./actions";

const STRATEGY_LABELS: Record<string, string> = {
  "1leg": "1-Leg",
  "2leg_lock": "2-Leg Lock",
  trend_impulse: "Trend Impulse",
  obi: "OBI",
  grid: "Grid",
};

export default async function AdminSetfilesPage() {
  const setfiles = await listAllSetfiles();

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Admin · Setfiles
          </span>
          <p className="mt-2 text-sm text-zinc-400">
            Strategy config library shown to licensed users on /setfiles, grouped by strategy.
          </p>
        </div>
        <EditSetfileForm action={createSetfileAction} mode="create" />
      </header>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Order</th>
                <th className="pb-2 pr-4">Strategy</th>
                <th className="pb-2 pr-4">Source</th>
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Updated</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {setfiles.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 text-zinc-400">{s.sortOrder}</td>
                  <td className="py-2 pr-4 text-zinc-200">{STRATEGY_LABELS[s.strategyKey] ?? s.strategyKey}</td>
                  <td className="py-2 pr-4 text-zinc-400">{s.source === "verified" ? "Verified" : "Example"}</td>
                  <td className="py-2 pr-4 text-zinc-200">{s.name}</td>
                  <td className="py-2 pr-4">
                    {s.active ? (
                      <span className="text-emerald-400">Active</span>
                    ) : (
                      <span className="text-zinc-500">Disabled</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{formatAbsoluteUtc(s.updatedAt)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-2">
                      <EditSetfileForm
                        action={updateSetfileAction}
                        id={s.id}
                        mode="edit"
                        defaults={{
                          strategyKey: s.strategyKey,
                          source: s.source,
                          name: s.name,
                          subtitle: s.subtitle,
                          explanation: s.explanation,
                          params: s.params,
                          sessionWindow: s.sessionWindow,
                          warnings: s.warnings,
                        }}
                      />
                      <ActionButton
                        action={moveSetfileAction}
                        hiddenFields={{ id: s.id, direction: "up" }}
                        label="Move up"
                        successMessage="Reordered"
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <ActionButton
                        action={moveSetfileAction}
                        hiddenFields={{ id: s.id, direction: "down" }}
                        label="Move down"
                        successMessage="Reordered"
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <ActionButton
                        action={toggleSetfileActiveAction}
                        hiddenFields={{ id: s.id, active: s.active ? "false" : "true" }}
                        label={s.active ? "Disable" : "Enable"}
                        successMessage={s.active ? "Setfile disabled" : "Setfile enabled"}
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <ActionButton
                        action={deleteSetfileAction}
                        hiddenFields={{ id: s.id }}
                        label="Delete"
                        successMessage="Setfile deleted"
                        className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {setfiles.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-zinc-500">
                    No setfiles yet — use &quot;Add strategy&quot; above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
