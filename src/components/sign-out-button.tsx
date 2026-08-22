import { signOut } from "@/lib/auth";

export function SignOutButton({
  className = "btn ghost sm",
  redirectTo = "/login",
}: {
  className?: string;
  redirectTo?: string;
}) {
  async function signOutAction() {
    "use server";
    await signOut({ redirectTo });
  }

  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
