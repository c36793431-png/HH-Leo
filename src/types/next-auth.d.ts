import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: string;
      /** Every role held in user_roles, not just the display value above --
       * see src/lib/user-roles.ts. */
      roles?: string[];
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
    roles?: string[];
    telegramUserId?: string;
  }
}
