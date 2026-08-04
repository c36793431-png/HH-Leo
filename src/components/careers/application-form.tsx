"use client";

import { useActionState, useRef, useState } from "react";
import { put } from "@vercel/blob/client";
import { submitApplicationAction } from "@/app/careers/actions";
import { ROLE_INTERESTS } from "@/lib/applications";

const MAX_CV_BYTES = 5 * 1024 * 1024;
const ALLOWED_CV_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const RATE_LIMIT_STORAGE_KEY = "hz_careers_last_apply";
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Courtesy-only client-side guard — the real rate limit is enforced server-side in
 * submitApplicationAction against the applications table, since localStorage is trivially
 * cleared/bypassed. This just avoids a pointless upload+submit round trip for the common case. */
function recentlyAppliedLocally(email: string): boolean {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (!raw) return false;
    const entries = JSON.parse(raw) as Record<string, number>;
    const last = entries[email.toLowerCase()];
    return typeof last === "number" && Date.now() - last < RATE_LIMIT_WINDOW_MS;
  } catch {
    return false;
  }
}

function recordLocalSubmission(email: string): void {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    const entries = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    entries[email.toLowerCase()] = Date.now();
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // best-effort only
  }
}

export function ApplicationForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [state, formAction, isPending] = useActionState(
    async (_prevState: Awaited<ReturnType<typeof submitApplicationAction>> | null, formData: FormData) => {
      const result = await submitApplicationAction(null, formData);
      if (result.ok) {
        setSucceeded(true);
        const email = (formData.get("email") as string) ?? "";
        if (email) recordLocalSubmission(email);
      }
      return result;
    },
    null
  );

  const busy = isUploading || isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const email = ((formData.get("email") as string) ?? "").trim();
    if (recentlyAppliedLocally(email)) {
      setLocalError("You've already applied recently — we'll be in touch. Try again in 24h if this seems wrong.");
      return;
    }

    const file = formData.get("cv") as File | null;
    if (file && file.size > 0) {
      if (!ALLOWED_CV_TYPES.includes(file.type)) {
        setLocalError("CV must be a PDF or DOCX file.");
        return;
      }
      if (file.size > MAX_CV_BYTES) {
        setLocalError("CV must be under 5MB.");
        return;
      }

      setIsUploading(true);
      try {
        const tokenRes = await fetch("/api/careers/apply/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        const tokenBody = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenBody?.error || "Failed to prepare CV upload");

        const blob = await put(tokenBody.pathname, file, {
          access: "private",
          token: tokenBody.token,
          contentType: file.type,
        });
        formData.set("cvBlobPathname", blob.pathname);
      } catch (err) {
        setIsUploading(false);
        setLocalError(err instanceof Error ? err.message : "CV upload failed");
        return;
      }
      setIsUploading(false);
    }

    formAction(formData);
  }

  if (succeeded) {
    return (
      <div id="apply-form" className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
        <p className="text-sm font-medium text-emerald-300">Application received.</p>
        <p className="mt-1 text-xs text-zinc-400">We&apos;ll be in touch via email.</p>
      </div>
    );
  }

  return (
    <form
      id="apply-form"
      ref={formRef}
      onSubmit={handleSubmit}
      className="rounded-xl border border-cyan-500/10 bg-[#0b0e16]/60 p-5 sm:p-6"
    >
      <h3 className="text-sm font-medium text-zinc-300">Apply</h3>
      <p className="mt-1.5 text-xs text-zinc-500">Tell us about yourself — we review every application.</p>

      {/* Honeypot — hidden from real users via CSS, bots that fill every field trip this. */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-zinc-500">Name</label>
          <input
            name="name"
            type="text"
            required
            disabled={busy}
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Email</label>
          <input
            name="email"
            type="email"
            required
            disabled={busy}
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500">Role interest</label>
          <select
            name="roleInterest"
            required
            disabled={busy}
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200"
          >
            {ROLE_INTERESTS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-zinc-500">CV (PDF or DOCX, max 5MB)</label>
          <input
            name="cv"
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={busy}
            className="mt-1 w-full text-sm text-zinc-300"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-zinc-500">Message</label>
          <textarea
            name="message"
            rows={4}
            disabled={busy}
            className="mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200"
          />
        </div>
      </div>

      <input type="hidden" name="cvBlobPathname" value="" />

      {(localError || (state && !state.ok)) && (
        <p className="mt-3 text-xs text-red-400">{localError ?? (state && !state.ok ? state.error : "")}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isUploading ? "Uploading CV…" : isPending ? "Submitting…" : "Submit application"}
      </button>
    </form>
  );
}
