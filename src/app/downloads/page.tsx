import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser } from "@/lib/licenses";
import { getInstallerInfo } from "@/lib/portal-config";
import { DownloadButton } from "@/components/download-button";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

const PLACEHOLDER_VERSION = "1.0.0";
const PLACEHOLDER_CHANGELOG = "Release notes will appear here once the current build is published.";

export default async function DownloadsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const paid = await isPaidUser(session.user.id).catch(() => false);
  if (!paid) redirect("/dashboard");

  const [license, installer] = await Promise.all([
    getActiveLicenseForUser(session.user.id).catch(() => null),
    getInstallerInfo().catch(() => null),
  ]);

  const isAdmin = isAdminUsersPanelEmail(session.user.email);
  const version = installer?.version ?? PLACEHOLDER_VERSION;
  const changelog = installer?.changelog ?? PLACEHOLDER_CHANGELOG;
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={isAdmin ? "admin" : "paid"} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid g2">
        <div className="card">
          <div className="chead">
            <span className="ic">▤</span>
            <h3>Latest build</h3>
            <span className="cap">v{version}</span>
          </div>
          <div className="rows">
            <div className="rw">
              <div className="ricon">⤓</div>
              <div className="rmeta">
                <b>Horizon Terminal — Windows</b>
                <span>SHA256 verified</span>
              </div>
              <span className="ver">v{version}</span>
            </div>
            <div className="rw">
              <div className="ricon">⤓</div>
              <div className="rmeta">
                <b>Horizon Terminal — macOS</b>
                <span>Notarised</span>
              </div>
              <span className="ver">v{version}</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {installer ? (
              <DownloadButton />
            ) : (
              <button type="button" disabled title="Build not yet published" className="btn primary sm">
                Download installer
              </button>
            )}
          </div>
          {installer && (
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--hz-ink-3)" }}>
              {installer.filename} · uploaded {new Date(installer.uploadedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        <div className="card">
          <div className="chead">
            <span className="ic">≡</span>
            <h3>Changelog</h3>
          </div>
          <p style={{ fontSize: 13, color: "var(--hz-ink-2)", whiteSpace: "pre-line", lineHeight: 1.6 }}>{changelog}</p>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">◐</span>
            <h3>Your license</h3>
          </div>
          <div className="keyrow">
            <span className="k">{license?.licenseKey ?? "—"}</span>
          </div>
          {license && (
            <p style={{ marginTop: 10, fontSize: 12, color: "var(--hz-ink-3)" }}>
              Expires {new Date(license.expiresAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
