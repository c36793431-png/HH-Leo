"use client";

import { useActionState, useEffect, useRef } from "react";
import type { ActionResult } from "@/lib/action-result";
import { emitToast } from "@/lib/toast-bus";

interface EditDownloadFormProps {
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  id: string;
  defaultVersion: string;
  defaultChangelog: string;
}

/** Row-level fix for a typo'd version string or changelog after upload — no Blob rewrite. */
export function EditDownloadForm({ action, id, defaultVersion, defaultChangelog }: EditDownloadFormProps) {
  const [state, formAction, isPending] = useActionState(action, null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (state === null) return;
    if (state.ok) {
      emitToast("Build updated", "success");
      if (detailsRef.current) detailsRef.current.open = false;
    } else {
      emitToast(state.error, "error");
    }
  }, [state]);

  return (
    <details ref={detailsRef}>
      <summary className="cursor-pointer select-none rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-cyan-500 hover:text-cyan-300">
        Edit
      </summary>
      <form
        action={formAction}
        className="mt-2 flex flex-col gap-2 rounded border border-zinc-800 bg-black/60 p-2"
      >
        <input type="hidden" name="id" value={id} />
        <label className="text-[11px] text-zinc-500">
          Version
          <input
            type="text"
            name="version"
            defaultValue={defaultVersion}
            required
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200"
          />
        </label>
        <label className="text-[11px] text-zinc-500">
          Changelog
          <textarea
            name="changelog"
            defaultValue={defaultChangelog}
            rows={3}
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-1.5 py-0.5 text-xs text-zinc-200"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded bg-emerald-500/90 px-2 py-1 text-xs font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Working…" : "Save"}
        </button>
        {state && !state.ok && <p className="text-xs text-red-400">{state.error}</p>}
      </form>
    </details>
  );
}
