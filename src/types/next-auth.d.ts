import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      role?: string;
      telegramUserId?: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    telegramUserId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    telegramUserId?: string;
  }
}
