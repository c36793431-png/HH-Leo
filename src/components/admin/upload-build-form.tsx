"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { put } from "@vercel/blob/client";
import { PLATFORMS, type Platform } from "@/lib/downloads";
import { emitToast } from "@/lib/toast-bus";

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Uploads a build straight from the browser to Vercel Blob (PUT with a scoped client token),
 * then hands only small JSON metadata to a server route to record the version row — avoids the
 * ~4.5MB body limit that a server action / API route handler would hit for the raw file. */
export function UploadBuildForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const version = (formData.get("version") as string)?.trim();
    const changelog = (formData.get("changelog") as string)?.trim();
    const file = formData.get("file") as File | null;

    if (!version || !file || file.size === 0) {
      emitToast("Version and file are required", "error");
      return;
    }

    setIsUploading(true);
    try {
      const tokenRes = await fetch("/api/admin/downloads/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, platform, filename: file.name }),
      });
      const tokenBody = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(tokenBody?.error || "Failed to get upload URL");

      const [sha256, blob] = await Promise.all([
        sha256Hex(file),
        put(tokenBody.pathname, file, {
          access: "private",
          token: tokenBody.token,
          contentType: file.type || "application/octet-stream",
        }),
      ]);

      const finalizeRes = await fetch("/api/admin/downloads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          blobPathname: blob.pathname,
          version,
          platform,
          changelog: changelog || undefined,
          sha256,
          sizeBytes: file.size,
        }),
      });
      const finalizeBody = await finalizeRes.json();
      if (!finalizeRes.ok || !finalizeBody.ok) throw new Error(finalizeBody?.error || "Failed to record build");

      emitToast(`Build v${version} uploaded`, "success");
      formRef.current?.reset();
      setPlatform("windows");
      router.refresh();
    } catch (err) {
      emitToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs text-zinc-500">Version</label>
        <input
          name="version"
          type="text"
          placeholder="4.2.1"
          required
          disabled={isUploading}
          className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Platform</label>
        <select
          name="platform"
          required
          disabled={isUploading}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
        >
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-zinc-500">File</label>
        <input name="file" type="file" required disabled={isUploading} className="mt-1 text-sm text-zinc-300" />
      </div>
      <div>
        <label className="block text-xs text-zinc-500">Changelog</label>
        <textarea
          name="changelog"
          rows={2}
          placeholder="What changed in this build"
          disabled={isUploading}
          className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
        />
      </div>
      <button
        type="submit"
        disabled={isUploading}
        className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isUploading ? "Uploading…" : "Upload build"}
      </button>
    </form>
  );
}
