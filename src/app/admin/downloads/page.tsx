import { listDownloads, PLATFORMS } from "@/lib/downloads";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { uploadDownloadAction, deleteDownloadAction } from "./actions";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export default async function AdminDownloadsPage() {
  const downloads = await listDownloads();

  return (
    <div className="flex flex-1 flex-col">
      <header className="mb-8">
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Downloads
        </span>
        <p className="mt-2 text-sm text-zinc-400">
          Publish Windows/macOS builds to private Vercel Blob storage — customers only ever see a signed,
          license-gated link, never the raw Blob URL.
        </p>
      </header>

      <section className="mb-8 rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Upload a build</h2>
        <form action={uploadDownloadAction} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-zinc-500">Version</label>
            <input
              name="version"
              type="text"
              placeholder="4.2.1"
              required
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Platform</label>
            <select
              name="platform"
              required
              defaultValue="windows"
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
            <input name="file" type="file" required className="mt-1 text-sm text-zinc-300" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500">Changelog</label>
            <textarea
              name="changelog"
              rows={2}
              placeholder="What changed in this build"
              className="mt-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-sm text-zinc-200"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400"
          >
            Upload build
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="mb-4 text-sm font-medium text-cyan-400">Versions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="pb-2 pr-4">Version</th>
                <th className="pb-2 pr-4">Platform</th>
                <th className="pb-2 pr-4">Size</th>
                <th className="pb-2 pr-4">SHA256</th>
                <th className="pb-2 pr-4">Uploaded</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {downloads.map((d) => (
                <tr key={d.id}>
                  <td className="py-2 pr-4 text-zinc-200">v{d.version}</td>
                  <td className="py-2 pr-4 text-zinc-400">{d.platform}</td>
                  <td className="py-2 pr-4 text-zinc-400">{formatBytes(d.sizeBytes)}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-zinc-500" title={d.sha256}>
                    {d.sha256.slice(0, 12)}…
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {formatAbsoluteUtc(d.uploadedAt)} <span className="text-zinc-600">({formatRelative(d.uploadedAt)})</span>
                  </td>
                  <td className="py-2">
                    <form action={deleteDownloadAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {downloads.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-zinc-500">
                    No builds uploaded yet.
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
