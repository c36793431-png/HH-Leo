import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Resend from "next-auth/providers/resend";
import PostgresAdapter from "@auth/pg-adapter";
import { pool } from "./db";
import { verifyTelegramLogin, type TelegramLoginPayload } from "./telegram-auth";
import { claimPendingLicense } from "./licenses";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "jwt" },
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

        const payload = {
          ...raw,
          id: Number(raw.id),
          auth_date: Number(raw.auth_date),
        } as TelegramLoginPayload;

        if (!verifyTelegramLogin(payload, botToken)) return null;

        const existing = await pool.query(
          `select id, email, telegram_user_id, telegram_username, display_name, role
           from users where telegram_user_id = $1`,
          [payload.id]
        );

        let user = existing.rows[0];
        if (!user) {
          const displayName = [payload.first_name, payload.last_name]
            .filter(Boolean)
            .join(" ") || payload.username || `tg_${payload.id}`;
          const inserted = await pool.query(
            `insert into users (telegram_user_id, telegram_username, display_name)
             values ($1, $2, $3)
             returning id, email, telegram_user_id, telegram_username, display_name, role`,
            [payload.id, payload.username ?? null, displayName]
          );
          user = inserted.rows[0];
          await claimPendingLicense({ userId: user.id, telegramUserId: payload.id });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.display_name,
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
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as string) ?? "user";
        session.user.telegramUserId = token.telegramUserId as string | undefined;
      }
      return session;
    },
    async signIn({ user }) {
      // Email-provider first-time signups: claim any pre-provisioned license by email.
      if (user?.email) {
        await claimPendingLicense({ userId: user.id!, email: user.email });
      }
      return true;
    },
  },
  pages: {
    signIn: "/login",
  },
});
