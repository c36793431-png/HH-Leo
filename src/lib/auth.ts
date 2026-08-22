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
          notifyFreeSignup({ email: user.email, joinedAt: new Date(), source: "telegram" }).catch(() => {});
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
      notifyFreeSignup({ email: user.email ?? null, joinedAt: new Date(), source: "email" }).catch(() => {});
    },
  },
  pages: {
    signIn: "/login",
  },
});
