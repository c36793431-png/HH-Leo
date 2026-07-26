import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { pool } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { LicenseStatusCard } from "@/components/license-status-card";
import { SignOutButton } from "@/components/sign-out-button";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, config, telegramRow, botUsername] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    pool
      .query<{ telegram_user_id: string | null; telegram_username: string | null }>(
        "select telegram_user_id, telegram_username from users where id = $1",
        [session.user.id]
      )
      .then((r) => r.rows[0] ?? { telegram_user_id: null, telegram_username: null})
      .catch(() => ({ telegram_user_id: null, telegram_username: null })),
    getBotUsername(),
  ]);
  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUsersPanelEmail(session.user.email);
  const telegramLinked = telegramRow.telegram_user_id !== null;

  const tier = isAdmin ? "admin" : paid ? "paid" : "free";
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">◔</span>
            <h3>Profile</h3>
          </div>
          <div className="rows">
            <div className="rw">
              <div className="ricon">@</div>
              <div className="rmeta">
                <b>{userName}</b>
                <span>{userEmail}</span>
              </div>
            </div>
            <div className="rw">
              <div className="ricon">✈</div>
              <div className="rmeta">
                <b>Telegram</b>
                <span>{telegramLinked ? `Linked · @${telegramRow.telegram_username ?? "—"}` : "Not linked"}</span>
              </div>
            </div>
          </div>
          {!telegramLinked && (
            <div className="tgcta">
              <div className="ricon" style={{ color: "var(--hz-cyan)" }}>
                ✈
              </div>
              <div className="rmeta">
                <b>Link your Telegram</b>
                <span>Receive your license and group invite over Telegram.</span>
              </div>
              {botUsername ? (
                <LinkTelegramButton botUsername={botUsername} />
              ) : (
                <span className="rmeta">
                  <span>Telegram linking unavailable — bot not configured.</span>
                </span>
              )}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <SignOutButton />
          </div>
        </div>

        <LicenseStatusCard license={licenseDetail} telegramChannelUrl={config.telegramChannelUrl} isAdminAccount={isAdmin} />
      </div>
    </PortalShell>
  );
}
