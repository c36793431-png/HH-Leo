import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ConfigSummaryForm } from "@/components/admin/config-summary-form";
import { getConfigSummary } from "@/lib/config-summary";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { saveMyConfigSummaryAction, deleteMyConfigSummaryAction } from "./actions";

export default async function MySetupPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, configSummary] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getConfigSummary(session.user.id),
  ]);
  const isAdmin = isAdminUser(session.user);

  const tier = isAdmin ? "admin" : paid ? "paid" : "free";
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">⚙</span>
            <h3>My setup</h3>
          </div>
          <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
            Share your Horizon setup with us. This helps us support you faster and helps other
            traders benefit from what works. You can edit or clear this any time — we never
            collect it silently.
          </p>
          <ConfigSummaryForm
            action={saveMyConfigSummaryAction}
            userId={session.user.id}
            value={configSummary}
            deleteAction={configSummary ? deleteMyConfigSummaryAction : undefined}
            savedMessage="Your setup was saved"
          />
          {configSummary && (
            <p style={{ marginTop: 16, fontSize: 12, color: "var(--hz-ink-2)" }}>
              Last updated by {configSummary.updatedByEmail ?? "you"} on{" "}
              {formatAbsoluteUtc(configSummary.updatedAt)} —{" "}
              {configSummary.source === "admin_verified" ? "admin-verified" : "self-reported"}
            </p>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
