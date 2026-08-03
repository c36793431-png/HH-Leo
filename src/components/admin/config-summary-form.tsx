"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";
import {
  CONFIG_SUMMARY_STRATEGIES,
  parseConfigSummaryPaste,
  stringifyConfigParams,
  type ConfigSummary,
  type ConfigSummaryStrategy,
} from "@/lib/config-summary";

interface ConfigSummaryFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  userId: string;
  value: ConfigSummary | null;
  showPaste?: boolean;
  savedMessage?: string;
  deleteAction?: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onDeleted?: () => void;
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50";
const labelClass = "text-xs text-zinc-500";

/** Shared by /admin/users/[id] (source=admin_verified) and /account/my-setup
 * (source=self_reported) — same field set and layout, only the action + paste box differ. */
export function ConfigSummaryForm({
  action,
  userId,
  value,
  showPaste,
  savedMessage,
  deleteAction,
  onDeleted,
}: ConfigSummaryFormProps) {
  const [broker, setBroker] = useState(value?.broker ?? "");
  const [accountType, setAccountType] = useState(value?.accountType ?? "");
  const [commission, setCommission] = useState(value?.commissionPtsRoundTrip?.toString() ?? "");
  const [feedProvider, setFeedProvider] = useState(value?.fastFeedProvider ?? "");
  const [symbols, setSymbols] = useState(value?.symbols.join(", ") ?? "");
  const [strategy, setStrategy] = useState<ConfigSummaryStrategy | "">(value?.strategy ?? "");
  const [configParams, setConfigParams] = useState(value ? stringifyConfigParams(value.configJson) : "");
  const [notes, setNotes] = useState(value?.notes ?? "");
  const [paste, setPaste] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function applyPaste() {
    const parsed = parseConfigSummaryPaste(paste);
    if (parsed.broker !== undefined) setBroker(parsed.broker ?? "");
    if (parsed.accountType !== undefined) setAccountType(parsed.accountType ?? "");
    if (parsed.commissionPtsRoundTrip !== undefined) setCommission(String(parsed.commissionPtsRoundTrip ?? ""));
    if (parsed.fastFeedProvider !== undefined) setFeedProvider(parsed.fastFeedProvider ?? "");
    if (parsed.symbols !== undefined) setSymbols(parsed.symbols.join(", "));
    if (parsed.strategy !== undefined) setStrategy(parsed.strategy ?? "");
    if (parsed.configJson !== undefined) setConfigParams(stringifyConfigParams(parsed.configJson));
    if (parsed.notes !== undefined) setNotes(parsed.notes ?? "");
    emitToast("Paste parsed — review fields below and save", "success");
  }

  function handleSave() {
    const formData = new FormData();
    formData.append("userId", userId);
    formData.append("broker", broker);
    formData.append("accountType", accountType);
    formData.append("commissionPtsRoundTrip", commission);
    formData.append("fastFeedProvider", feedProvider);
    formData.append("symbols", symbols);
    formData.append("strategy", strategy);
    formData.append("configParams", configParams);
    formData.append("notes", notes);

    startTransition(async () => {
      const result = await action(null, formData);
      if (result.ok) {
        emitToast(savedMessage ?? "Config summary saved", "success");
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  function handleDelete() {
    if (!deleteAction) return;
    if (!confirm("Clear your config summary? This removes the current record entirely.")) return;
    const formData = new FormData();
    formData.append("userId", userId);

    startDeleteTransition(async () => {
      const result = await deleteAction(null, formData);
      if (result.ok) {
        setBroker("");
        setAccountType("");
        setCommission("");
        setFeedProvider("");
        setSymbols("");
        setStrategy("");
        setConfigParams("");
        setNotes("");
        emitToast("Config summary cleared", "success");
        onDeleted?.();
      } else {
        emitToast(result.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-4"
    >
      {showPaste && (
        <div className="rounded border border-zinc-700 bg-black/20 p-3">
          <p className={labelClass}>Paste config (quick-entry)</p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={6}
            placeholder={"Broker: PUPrime (ECN)\nCommission: 8 pts round-trip\nFeed: Horizon CFD (LD)\nSymbol: XAUUSD.p\nStrategy: 1 Leg\nConfig: Gap=35 / SL=30 / TP=100 / Trail Start=45 / Trail Dist=3\nNotes: whatever"}
            className={`${inputClass} mt-1 font-mono text-xs`}
          />
          <button
            type="button"
            onClick={applyPaste}
            disabled={!paste.trim()}
            className="mt-2 rounded border border-zinc-700 px-2 py-1 text-xs text-cyan-300 hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Parse into fields
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Broker</label>
          <input value={broker} onChange={(e) => setBroker(e.target.value)} disabled={isPending} className={inputClass} placeholder="PUPrime, Opogroup, Fxview…" />
        </div>
        <div>
          <label className={labelClass}>Account type</label>
          <input value={accountType} onChange={(e) => setAccountType(e.target.value)} disabled={isPending} className={inputClass} placeholder="ECN, Standard…" />
        </div>
        <div>
          <label className={labelClass}>Commission (pts round-trip)</label>
          <input
            type="number"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            disabled={isPending}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Fast feed provider</label>
          <input
            value={feedProvider}
            onChange={(e) => setFeedProvider(e.target.value)}
            disabled={isPending}
            className={inputClass}
            placeholder="Horizon CFD…"
          />
        </div>
        <div>
          <label className={labelClass}>Symbols (comma-separated)</label>
          <input value={symbols} onChange={(e) => setSymbols(e.target.value)} disabled={isPending} className={inputClass} placeholder="XAUUSD.p, EURUSD" />
        </div>
        <div>
          <label className={labelClass}>Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as ConfigSummaryStrategy | "")}
            disabled={isPending}
            className={inputClass}
          >
            <option value="">—</option>
            {CONFIG_SUMMARY_STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Config params (Gap=35 / SL=30 / TP=100 / …)</label>
          <input
            value={configParams}
            onChange={(e) => setConfigParams(e.target.value)}
            disabled={isPending}
            className={`${inputClass} font-mono`}
            placeholder="Gap=35 / SL=30 / TP=100 / Trail Start=45 / Trail Dist=3 / Shift=0 / MaxSpread=20"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isPending} rows={3} className={inputClass} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save config summary"}
        </button>
        {deleteAction && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-red-400 hover:border-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? "Clearing…" : "Delete config summary"}
          </button>
        )}
      </div>
    </form>
  );
}
