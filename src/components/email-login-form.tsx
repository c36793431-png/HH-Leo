import { signIn } from "@/lib/auth";
import { pool } from "@/lib/db";

async function emailSignIn(redirectTo: string, formData: FormData) {
  "use server";
  const email = formData.get("email") as string;
  const name = (formData.get("name") as string | null)?.trim() || null;
  const telegramRaw = (formData.get("telegram") as string | null)?.trim() || null;
  const telegramHandle = telegramRaw ? telegramRaw.replace(/^@/, "") : null;

  if (email && (name || telegramHandle)) {
    await pool
      .query(
        `insert into pending_signups (email, name, telegram_handle)
         values ($1, $2, $3)
         on conflict (email) do update
           set name = excluded.name, telegram_handle = excluded.telegram_handle, created_at = now()`,
        [email, name, telegramHandle]
      )
      .catch((err) => {
        // Signup must succeed even if the staging write fails — worst case the
        // notification/name backfill is missing name/telegram, not blocked.
        console.error("pending_signups upsert failed", err);
      });
  }

  await signIn("resend", { email, redirectTo });
}

export function EmailLoginForm({
  redirectTo,
  mode,
}: {
  redirectTo: string;
  mode: "login" | "signup";
}) {
  const emailSignInWithRedirect = emailSignIn.bind(null, redirectTo);

  return (
    <form action={emailSignInWithRedirect} className="flex flex-col gap-3">
      {mode === "signup" && (
        <>
          <label htmlFor="name" className="text-sm text-zinc-400">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            placeholder="Jane Trader"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
          />
          <label htmlFor="telegram" className="text-sm text-zinc-400">
            Telegram handle (optional)
          </label>
          <input
            id="telegram"
            name="telegram"
            type="text"
            placeholder="@yourhandle"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
          />
        </>
      )}
      <label htmlFor="email" className="text-sm text-zinc-400">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        placeholder="you@example.com"
        className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-cyan-400"
      />
      <button
        type="submit"
        className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
      >
        Continue with email
      </button>
    </form>
  );
}
