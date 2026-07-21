import { signIn } from "@/lib/auth";

async function emailSignIn(formData: FormData) {
  "use server";
  await signIn("resend", { email: formData.get("email"), redirectTo: "/dashboard" });
}

export function EmailLoginForm() {
  return (
    <form action={emailSignIn} className="flex flex-col gap-3">
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
