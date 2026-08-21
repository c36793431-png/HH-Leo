import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { getLatestDownloads, type LatestDownloads } from "@/lib/downloads";
import { DownloadButton } from "@/components/download-button";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";

const PLACEHOLDER_CHANGELOG = "Release notes will appear here once the current build is published.";

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

export default async function DownloadsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const paid = await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  if (!paid && !isAdmin) redirect("/dashboard");

  const [license, licenseDetail, downloads] = await Promise.all([
    getActiveLicenseForUser(session.user.id).catch(() => null),
    getLicenseForUser(session.user.id).catch(() => null),
    getLatestDownloads().catch((): LatestDownloads => ({})),
  ]);

  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const changelog = downloads.windows?.changelog ?? PLACEHOLDER_CHANGELOG;
  const tier = computePortalTier(isAdmin, licenseDetail);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid g2">
        <div className="card">
          <div className="chead">
            <span className="ic">▤</span>
            <h3>Latest build</h3>
          </div>
          <div className="rows">
            <div className="rw">
              <div className="ricon">⤓</div>
              <div className="rmeta">
                <b>Horizon Terminal — Windows</b>
                <span>
                  {downloads.windows
                    ? `${formatSize(downloads.windows.sizeBytes)} · SHA256 ${downloads.windows.sha256.slice(0, 12)}…`
                    : "Not yet published"}
                </span>
              </div>
              <span className="ver">{downloads.windows ? `v${downloads.windows.version}` : "—"}</span>
            </div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            {downloads.windows && <DownloadButton version={downloads.windows.version} platform="windows" />}
            {!downloads.windows && (
              <button type="button" disabled title="Build not yet published" className="btn primary sm">
                Download installer
              </button>
            )}
          </div>
        </div>

        {/* Builds up to and including v2.0 rely on the machine already having the
            Microsoft Visual C++ runtime: the licence check loads libsodium, which imports
            vcruntime140.dll. On a clean Windows install that file is absent, the check
            cannot run, and the client reports it as a signature failure. Later builds ship
            the runtime alongside the executable, but this note stays for anyone installing
            an older download. */}
        <div className="card">
          <div className="chead">
            <span className="ic">!</span>
            <h3>Before you install</h3>
          </div>
          <p style={{ fontSize: 13, color: "var(--hz-ink-2)", lineHeight: 1.6 }}>
            Windows needs the{" "}
            <a
              href="https://aka.ms/vs/17/release/vc_redist.x64.exe"
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--hz-accent)", textDecoration: "underline" }}
            >
              Microsoft Visual C++ 2015-2022 Redistributable (x64)
            </a>{" "}
            before Horizon HFT can validate your licence. Most machines already have it. If
            yours does not, the terminal will report that the licence response failed
            signature verification even though your licence is perfectly valid — install the
            redistributable, restart the terminal, and activation will go through.
          </p>
        </div>

        <div className="card">
          <div className="chead">
            <span className="ic">≡</span>
            <h3>Changelog</h3>
          </div>
          <p style={{ fontSize: 13, color: "var(--hz-ink-2)", whiteSpace: "pre-line", lineHeight: 1.6 }}>{changelog}</p>
        </div>

        <div className="card">
          <div className="chead">
            <span className="ic">◐</span>
            <h3>Your license</h3>
          </div>
          <div className="keyrow">
            <span className={`k${license ? " ok" : ""}`}>{license?.licenseKey ?? "—"}</span>
          </div>
          {license && (
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--hz-ink-3)" }}>
              Expires {new Date(license.expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <span className="ic">↧</span>
            <h3>Download history</h3>
          </div>
          <div className="empty">
            <div className="eic">▤</div>
            <b>No downloads yet</b>
            <p>Once you grab the terminal installer, your version history shows up here.</p>
          </div>
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
