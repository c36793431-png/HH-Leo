"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";
import { VPS_PROVIDERS, type ServerRegistration } from "@/lib/server-registration";

interface ServerRegistrationFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  value: ServerRegistration | null;
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50";
const labelClass = "text-xs text-zinc-500";

export function ServerRegistrationForm({ action, value }: ServerRegistrationFormProps) {
  const [serverName, setServerName] = useState(value?.serverName ?? "");
  const [vpsProvider, setVpsProvider] = useState(value?.vpsProvider ?? "");
  const [vpsProviderOther, setVpsProviderOther] = useState(value?.vpsProviderOther ?? "");
  const [serverLocation, setServerLocation] = useState(value?.serverLocation ?? "");
  const [declaredIp, setDeclaredIp] = useState(value?.declaredIp ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const formData = new FormData();
    formData.append("serverName", serverName);
    formData.append("vpsProvider", vpsProvider);
    formData.append("vpsProviderOther", vpsProviderOther);
    formData.append("serverLocation", serverLocation);
    formData.append("declaredIp", declaredIp);

    startTransition(async () => {
      const result = await action(null, formData);
      if (result.ok) {
        emitToast(value ? "Server details updated" : "Server registered", "success");
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
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Server name</label>
          <input
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            disabled={isPending}
            className={inputClass}
            placeholder="London-01, vps-primary…"
          />
        </div>
        <div>
          <label className={labelClass}>VPS provider</label>
          <select
            value={vpsProvider}
            onChange={(e) => setVpsProvider(e.target.value)}
            disabled={isPending}
            className={inputClass}
          >
            <option value="">Select…</option>
            {VPS_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {vpsProvider === "other" && (
          <div className="sm:col-span-2">
            <label className={labelClass}>Provider name</label>
            <input
              value={vpsProviderOther}
              onChange={(e) => setVpsProviderOther(e.target.value)}
              disabled={isPending}
              className={inputClass}
              placeholder="Provider name"
            />
          </div>
        )}
        <div>
          <label className={labelClass}>Server location</label>
          <input
            value={serverLocation}
            onChange={(e) => setServerLocation(e.target.value)}
            disabled={isPending}
            className={inputClass}
            placeholder="London, UK"
          />
        </div>
        <div>
          <label className={labelClass}>Server IP</label>
          <input
            value={declaredIp}
            onChange={(e) => setDeclaredIp(e.target.value)}
            disabled={isPending}
            className={`${inputClass} font-mono`}
            placeholder="203.0.113.10"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-emerald-400 hover:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Saving…" : value ? "Update server" : "Register server"}
      </button>
    </form>
  );
}
