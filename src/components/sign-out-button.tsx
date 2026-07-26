import { signOut } from "@/lib/auth";

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="btn ghost sm">
        Sign out
      </button>
    </form>
  );
}
