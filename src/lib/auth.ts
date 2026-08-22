import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import PostgresAdapter from "@auth/pg-adapter";
import { pool } from "./db";
import { verifyTelegramLogin, type TelegramLoginPayload } from "./telegram-auth";
import { claimPendingLicense, recordSigninEvent } from "./licenses";
import { sendTelegramMessage } from "./telegram-bot";
import { getPortalConfig } from "./portal-config";
import { notifyFreeSignup, notifyFirstLogin } from "./telemetry-sink";
import { getOrCreateReferralCode } from "./referrals";
import { attributeReferralFromCookie } from "./referrals-cookie";

const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

/** Amber-branded magic-link email for partner.horizonhft.com sign-ins (bus thread
 * leo-partner-magic-link-email-branding-2026-08-22). Kept separate from the member
 * template below so portal.horizonhft.com sign-ins are untouched. */
function partnerMagicLinkHtml(url: string, host: string) {
  const escapedHost = host.replace(/\./g, "&#8203;.");
  const logoUrl = `https://${host}/brand/horizon-logo-partner.png`;
  return `
<body style="background: #1a1206;">
  <table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: #241704; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center" style="padding: 20px 0 0 0;">
        <img src="${logoUrl}" alt="Horizon HFT Partners" width="180" style="display: block; max-width: 180px;" />
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: #f5e6c8;">
        Sign in to <strong>${escapedHost}</strong>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="#F5B547"><a href="${url}"
                target="_blank"
                style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: #241704; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid #D48B1E; display: inline-block; font-weight: bold;">Sign
                in</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: #cbb98f;">
        If you did not request this email you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
`;
}

function partnerMagicLinkText(url: string, host: string) {
  return `Sign in to ${host}\n${url}\n\n`;
}

/** Member (portal.horizonhft.com) magic-link email — mirrors @auth/core's default Resend
 * template verbatim (that module isn't part of its public export map, so it can't be
 * imported directly). Left untouched by the partner branding above. */
function memberMagicLinkHtml(url: string, host: string) {
  const escapedHost = host.replace(/\./g, "&#8203;.");
  const brandColor = "#346df1";
  return `
<body style="background: #f9f9f9;">
  <table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: #fff; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center"
        style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: #444;">
        Sign in to <strong>${escapedHost}</strong>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="${brandColor}"><a href="${url}"
                target="_blank"
                style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: #fff; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid ${brandColor}; display: inline-block; font-weight: bold;">Sign
                in</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: #444;">
        If you did not request this email you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
`;
}

function memberMagicLinkText(url: string, host: string) {
  return `Sign in to ${host}\n${url}\n\n`;
}

/** Cyan/teal-branded magic-link email for feed.horizonhft.com sign-ins (bus thread
 * leo-feed-provider-login-2026-08-22). Kept separate from the member/partner templates
 * above so those hosts are untouched. */
function feedMagicLinkHtml(url: string, host: string) {
  const escapedHost = host.replace(/\./g, "&#8203;.");
  return `
<body style="background: #05070b;">
  <table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: #0a121c; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center"
        style="padding: 20px 0px 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: #daf4f5;">
        Sign in to <strong>${escapedHost}</strong>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="#2de2e6"><a href="${url}"
                target="_blank"
                style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: #02171a; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid #14b8a6; display: inline-block; font-weight: bold;">Sign
                in</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: #8fb0b7;">
        If you did not request this email you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
`;
}

function feedMagicLinkText(url: string, host: string) {
  return `Sign in to ${host}\n${url}\n\n`;
}

async function sendWelcomeDm(telegramUserId: number, displayName: string) {
  try {
    const config = await getPortalConfig();
    await sendTelegramMessage(
      telegramUserId,
      `Welcome to Horizon HFT, ${displayName}!\n\n` +
        `Community: ${config.telegramChannelUrl}\n` +
        `Free Users group: ${config.telegramFreeGroupUrl}\n\n` +
        `Log in any time at horizonhft.com to see pricing and docs.`
    );
  } catch (err) {
    // Signup must succeed even if the DM fails (e.g. bot not yet started by user).
    console.error("sendWelcomeDm failed", err);
  }
}

// Shares one session across portal.horizonhft.com and partner.horizonhft.com (bus thread
// leo-partner-subdomain-auth-model-2026-08-21). Unset in dev so cookies still work against
// localhost, which can't carry a ".horizonhft.com"-scoped cookie.
const isProd = process.env.NODE_ENV === "production";
const cookieDomain = isProd ? ".horizonhft.com" : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "jwt" },
  trustHost: true,
  // Auth.js's csrf-token cookie defaults to a __Host- prefix under HTTPS, which the spec
  // forbids from carrying a Domain attribute — so sharing the session across subdomains means
  // every cookie in this trio needs an explicit, consistent domain/prefix, not just sessionToken.
  cookies: cookieDomain
    ? {
        sessionToken: {
          name: "__Secure-authjs.session-token",
          options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: cookieDomain },
        },
        callbackUrl: {
          name: "__Secure-authjs.callback-url",
          options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: cookieDomain },
        },
        csrfToken: {
          name: "__Secure-authjs.csrf-token",
          options: { httpOnly: true, sameSite: "lax", path: "/", secure: true, domain: cookieDomain },
        },
      }
    : undefined,
  providers: [
    Credentials({
      id: "telegram",
      name: "Telegram",
      credentials: {
        id: {},
        first_name: {},
        last_name: {},
        username: {},
        photo_url: {},
        auth_date: {},
        hash: {},
      },
      async authorize(raw) {
        const botToken = process.env.HORIZON_PORTAL_BOT_TOKEN;
        if (!botToken) throw new Error("HORIZON_PORTAL_BOT_TOKEN not configured");

        // Telegram widget signs ONLY these fields. Anything else (csrfToken,
        // callbackUrl, redirectTo, future NextAuth internals) must not enter
        // the HMAC payload or verification always fails.
        const r = raw as Record<string, unknown>;
        const payload = {
          id: Number(r.id),
          first_name: r.first_name,
          ...(r.last_name ? { last_name: r.last_name } : {}),
          ...(r.username ? { username: r.username } : {}),
          ...(r.photo_url ? { photo_url: r.photo_url } : {}),
          auth_date: Number(r.auth_date),
          hash: r.hash,
        } as TelegramLoginPayload;

        if (!verifyTelegramLogin(payload, botToken)) {
          console.error("[telegram-authorize] HMAC verification failed", {
            payloadKeys: Object.keys(payload),
            auth_date_age_sec: Math.floor(Date.now() / 1000) - payload.auth_date,
          });
          return null;
        }

        const existing = await pool.query(
          `select id, email, telegram_user_id, telegram_username, display_name, role, image
           from users where telegram_user_id = $1`,
          [payload.id]
        );

        let user = existing.rows[0];
        if (!user) {
          const displayName = [payload.first_name, payload.last_name]
            .filter(Boolean)
            .join(" ") || payload.username || `tg_${payload.id}`;
          const inserted = await pool.query(
            `insert into users (telegram_user_id, telegram_username, display_name, image)
             values ($1, $2, $3, $4)
             returning id, email, telegram_user_id, telegram_username, display_name, role, image`,
            [payload.id, payload.username ?? null, displayName, payload.photo_url ?? null]
          );
          user = inserted.rows[0];
          await claimPendingLicense({ userId: user.id, telegramUserId: payload.id });
          await getOrCreateReferralCode(user.id);
          await attributeReferralFromCookie(user.id).catch((err) => {
            console.error("attributeReferralFromCookie failed (telegram)", err);
          });
          await sendWelcomeDm(payload.id, user.display_name);
          notifyFreeSignup({
            email: user.email,
            name: user.display_name,
            telegramHandle: user.telegram_username,
            joinedAt: new Date(),
            source: "telegram",
          }).catch(() => {});
        } else if (payload.photo_url && payload.photo_url !== user.image) {
          const updated = await pool.query(
            `update users set image = $1, updated_at = now() where id = $2 returning image`,
            [payload.photo_url, user.id]
          );
          user.image = updated.rows[0].image;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.display_name,
          image: user.image,
          telegramUserId: String(user.telegram_user_id),
          role: user.role,
        };
      },
    }),
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM,
      // Partner-branded (amber) template for partner.horizonhft.com sign-ins; every other
      // host falls back to the provider's default member (blue) template, untouched.
      async sendVerificationRequest({ identifier: to, provider, url }) {
        const { host } = new URL(url);
        const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);
        const isFeedHost = host === FEED_HOST || host.startsWith(`${FEED_HOST}:`);
        const html = isPartnerHost
          ? partnerMagicLinkHtml(url, host)
          : isFeedHost
            ? feedMagicLinkHtml(url, host)
            : memberMagicLinkHtml(url, host);
        const text = isPartnerHost
          ? partnerMagicLinkText(url, host)
          : isFeedHost
            ? feedMagicLinkText(url, host)
            : memberMagicLinkText(url, host);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from: provider.from, to, subject: `Sign in to ${host}`, html, text }),
        });
        if (!res.ok) throw new Error("Resend error: " + JSON.stringify(await res.json()));
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role ?? "user";
        token.telegramUserId = user.telegramUserId;
      }

      // Re-read role from the DB on every refresh, not just at sign-in, so a
      // role flip (e.g. partner approval) takes effect without forcing the
      // user to log out/in first (bus thread
      // leo-partner-page-broken-auth-buttons-2026-08-22).
      if (token.sub) {
        const dbUser = await pool.query(`select role from users where id = $1`, [token.sub]);
        if (dbUser.rows[0]?.role) {
          token.role = dbUser.rows[0].role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = (token.role as string) ?? "user";
        session.user.telegramUserId = token.telegramUserId as string | undefined;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Email-provider first-time signups: claim any pre-provisioned license by email.
      if (user?.email) {
        await claimPendingLicense({ userId: user.id!, email: user.email });
      }
      if (user?.id) {
        await recordSigninEvent(user.id, account?.provider ?? "unknown").catch((err) => {
          // Signin must succeed even if the history log write fails.
          console.error("recordSigninEvent failed", err);
        });

        // Atomic claim: only the caller whose INSERT actually lands (rowCount 1)
        // gets to fire the alert, so two concurrent signIns for the same
        // brand-new user (e.g. a resend link clicked twice) can't both win a
        // count()-based race and double-send.
        const claimed = await pool
          .query("insert into first_login_alerts (user_id) values ($1) on conflict do nothing", [user.id])
          .catch((err) => {
            console.error("first_login_alerts claim failed", err);
            return null;
          });

        if (claimed && claimed.rowCount === 1) {
          notifyFirstLogin({
            email: user.email ?? null,
            loggedInAt: new Date(),
            source: account?.provider,
          }).catch(() => {});
        }
      }
      return true;
    },
  },
  events: {
    async createUser({ user }) {
      // Adapter-managed creation covers the Email/Resend path; the Telegram
      // path bypasses the adapter and is notified inline in `authorize` above.
      if (user.id) {
        await getOrCreateReferralCode(user.id);
        await attributeReferralFromCookie(user.id).catch((err) => {
          console.error("attributeReferralFromCookie failed (email)", err);
        });
      }

      // The Resend magic-link only creates this row when the link is clicked,
      // not at form-submit time — so any name/telegram the user typed on the
      // signup form was stashed in pending_signups and is read back here.
      let name = user.name ?? null;
      let telegramHandle: string | null = null;
      if (user.email) {
        const pending = await pool
          .query(`delete from pending_signups where email = $1 returning name, telegram_handle`, [user.email])
          .catch((err) => {
            console.error("pending_signups lookup failed", err);
            return null;
          });
        const row = pending?.rows[0];
        if (row) {
          name = row.name ?? name;
          telegramHandle = row.telegram_handle ?? null;
          if (user.id && (row.name || row.telegram_handle)) {
            await pool.query(
              `update users set name = coalesce($1, name), telegram_username = coalesce($2, telegram_username) where id = $3`,
              [row.name ?? null, row.telegram_handle ?? null, user.id]
            );
          }
        }
      }

      notifyFreeSignup({
        email: user.email ?? null,
        name,
        telegramHandle,
        joinedAt: new Date(),
        source: "email",
      }).catch(() => {});
    },
  },
  pages: {
    signIn: "/login",
  },
});
