import { listDownloads } from "@/lib/downloads";
import { formatAbsoluteUtc, formatRelative } from "@/lib/format-time";
import { deleteDownloadAction } from "./actions";
import { ActionButton } from "@/components/admin/action-button";
import { UploadBuildForm } from "@/components/admin/upload-build-form";

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

      <section className="mb-8 rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
        <h2 className="text-sm font-medium text-emerald-400">Upload a build</h2>
        <UploadBuildForm />
      </section>

      <section className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6">
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
                    <ActionButton
                      action={deleteDownloadAction}
                      hiddenFields={{ id: d.id }}
                      label="Delete"
                      successMessage="Build deleted"
                      className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                    />
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
