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
import { pickPrimaryRole } from "./user-roles";

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

// Upper bound on how long a sign-in waits for one Telegram sink alert. Long enough for a
// normal Telegram round-trip, short enough that a stalled sink never holds the login.
const NOTIFY_TIMEOUT_MS = 4000;

/** Awaited, bounded wrapper around a telemetry-sink alert (bus thread
 * kai-auth-callback-hardening-2026-09-11). Alerts used to be fired un-awaited
 * (`.catch(() => {})`), so on Vercel the invocation could end before the fetch resolved
 * and a real 2026-09-11 signup produced no alert. Awaiting keeps the invocation alive;
 * the Promise.race timeout keeps a hung sink from stalling sign-in past 4s. Never throws:
 * failure and timeout both land in one searchable log line. No waitUntil because
 * @vercel/functions is not a dependency. */
async function notifyBounded(label: string, ctx: Record<string, unknown>, alert: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${NOTIFY_TIMEOUT_MS}ms`)), NOTIFY_TIMEOUT_MS);
  });
  try {
    await Promise.race([alert, timeout]);
  } catch (err) {
    console.error(`[auth-events] ${label} failed`, ctx, err);
  } finally {
    clearTimeout(timer);
  }
}

function notifyFreeSignupBounded(opts: Parameters<typeof notifyFreeSignup>[0]): Promise<void> {
  return notifyBounded("notifyFreeSignup", { source: opts.source, email: opts.email }, notifyFreeSignup(opts));
}

/** Runs one login side effect inside an Auth.js event. @auth/core awaits events inline
 * (events.createUser at lib/actions/callback/handle-login.js:77, events.signIn at
 * lib/actions/callback/index.js:214 and :276), so an exception thrown from an event fails
 * an otherwise-complete login. Every step is therefore caught here and logged under one
 * greppable prefix; nothing is swallowed silently and nothing propagates. */
async function authEventStep(step: string, ctx: Record<string, unknown>, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[auth-events] ${step} failed`, ctx, err);
  }
}

/** Adapter-created users come only from the Resend magic-link provider (id "resend",
 * @auth/core/providers/resend.js:5). events.createUser carries no `account`, so the
 * provider name for that first signin_events row is fixed here. */
const EMAIL_PROVIDER_ID = "resend";

/** The three FK-bearing per-login writes (bus thread kai-auth-first-login-writes-2026-09-12).
 * They used to live in the signIn CALLBACK, which on a first magic-link login runs with a
 * phantom user id (lib/actions/callback/index.js:156-167) before the adapter has inserted
 * the users row (handle-login.js:76), so all three tripped their users(id) FK and were
 * swallowed: 17/17 adapter-created users had no first-login signin_events or
 * first_login_alerts row. They now run only from events, where the row is committed. Each
 * step is isolated so one failure does not stop the others. */
async function recordLoginWrites(args: { userId: string; email: string | null; provider: string }): Promise<void> {
  const { userId, email, provider } = args;
  const ctx = { userId, email, provider };

  // Claim any licence pre-provisioned by email. Idempotent: the UPDATE only touches rows
  // whose user_id is still null, so re-running it on every login is a no-op after the first.
  if (email) {
    await authEventStep("claimPendingLicense", ctx, () => claimPendingLicense({ userId, email }));
  }

  await authEventStep("recordSigninEvent", ctx, () => recordSigninEvent(userId, provider));

  // Atomic first-login claim: only the caller whose INSERT actually lands (rowCount 1)
  // fires the alert, so two concurrent logins for the same brand-new user (e.g. a resend
  // link clicked twice) cannot both win a count()-based race and double-send.
  await authEventStep("firstLoginAlert", ctx, async () => {
    const claimed = await pool.query(
      "insert into first_login_alerts (user_id) values ($1) on conflict do nothing",
      [userId]
    );
    if (claimed.rowCount === 1) {
      await notifyBounded(
        "notifyFirstLogin",
        ctx,
        notifyFirstLogin({ email, loggedInAt: new Date(), source: provider })
      );
    }
  });
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
          await notifyFreeSignupBounded({
            email: user.email,
            name: user.display_name,
            telegramHandle: user.telegram_username,
            joinedAt: new Date(),
            source: "telegram",
          });
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

      // Re-read roles from the DB on every refresh, not just at sign-in, so a
      // role flip (e.g. partner approval) takes effect without forcing the
      // user to log out/in first (bus thread
      // leo-partner-page-broken-auth-buttons-2026-08-22).
      //
      // Reads user_roles, not users.role (user-roles-migration-2026-09-01 step
      // 2) -- a user can hold more than one role, and users.role alone can't
      // show that. This replaces the previous single-row users query one-for-
      // one rather than adding a second query alongside it.
      if (token.sub) {
        const roleRows = await pool.query<{ role: string }>(
          `select role from user_roles where user_id = $1`,
          [token.sub]
        );
        const roles = roleRows.rows.map((r) => r.role);
        if (roles.length > 0) {
          token.roles = roles;
          token.role = pickPrimaryRole(roles);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = (token.role as string) ?? "user";
        session.user.roles = (token.roles as string[] | undefined) ?? [session.user.role];
        session.user.telegramUserId = token.telegramUserId as string | undefined;
      }
      return session;
    },
    // No signIn callback: there is no allow/deny logic, and the per-login DB writes that
    // used to live here were moved to `events` below (see recordLoginWrites) because on a
    // first magic-link login this callback runs before the users row exists.
  },
  // Event order at the installed @auth/core 0.41.2 (next-auth 5.0.0-beta.31):
  //   first magic-link login : adapter.createUser -> events.createUser (handle-login.js:76-77)
  //                            -> callbacks.jwt -> events.signIn({ isNewUser: true }) (callback/index.js:214)
  //   returning magic-link   : adapter.updateUser -> events.updateUser (handle-login.js:68-72)
  //                            -> callbacks.jwt -> events.signIn({ isNewUser: false })
  //   telegram (credentials) : authorize() -> callbacks.jwt -> events.signIn({ user, account }) (index.js:276)
  // Both events fire on a first magic-link login, so events.signIn skips the writes when
  // isNewUser is true: events.createUser already made them on the same request.
  events: {
    async createUser({ user }) {
      // Adapter-managed creation covers the Email/Resend path; the Telegram
      // path bypasses the adapter and is notified inline in `authorize` above.
      const ctx = { userId: user.id, email: user.email };
      if (user.id) {
        const userId = user.id;
        await authEventStep("getOrCreateReferralCode", ctx, () => getOrCreateReferralCode(userId));
        await authEventStep("attributeReferralFromCookie", ctx, () => attributeReferralFromCookie(userId));
      }

      // The Resend magic-link only creates this row when the link is clicked,
      // not at form-submit time — so any name/telegram the user typed on the
      // signup form was stashed in pending_signups and is read back here.
      let name = user.name ?? null;
      let telegramHandle: string | null = null;
      if (user.email) {
        const email = user.email;
        await authEventStep("pendingSignupMerge", ctx, async () => {
          const pending = await pool.query(
            `delete from pending_signups where email = $1 returning name, telegram_handle`,
            [email]
          );
          const row = pending.rows[0];
          if (!row) return;
          name = row.name ?? name;
          telegramHandle = row.telegram_handle ?? null;
          if (user.id && (row.name || row.telegram_handle)) {
            await pool.query(
              `update users set name = coalesce($1, name), telegram_username = coalesce($2, telegram_username) where id = $3`,
              [row.name ?? null, row.telegram_handle ?? null, user.id]
            );
          }
        });
      }

      await notifyFreeSignupBounded({
        email: user.email ?? null,
        name,
        telegramHandle,
        joinedAt: new Date(),
        source: "email",
      });

      // First-login writes for adapter-created users. adapter.createUser has returned by
      // the time this event runs, so the users row is committed and the FKs hold.
      if (user.id) {
        await recordLoginWrites({ userId: user.id, email: user.email ?? null, provider: EMAIL_PROVIDER_ID });
      }
    },
    async signIn({ user, account, isNewUser }) {
      // Double-write guard: on a first magic-link login events.createUser already recorded
      // this login on the same request (see event-order note above). Telegram logins pass
      // no isNewUser (index.js:276) and always land here; their users row was inserted
      // in `authorize` before this event, so the FKs hold.
      if (isNewUser) return;
      if (!user.id) return;
      await recordLoginWrites({
        userId: user.id,
        email: user.email ?? null,
        provider: account?.provider ?? "unknown",
      });
    },
  },
  pages: {
    signIn: "/login",
  },
});
