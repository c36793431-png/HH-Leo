import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";
import { getPostAuthRedirect } from "@/lib/post-auth-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const redirectTo = getPostAuthRedirect((await headers()).get("host"));

  const session = await auth();
  if (session) redirect(redirectTo);

  const botUsername = await getBotUsername();
  const { error } = await searchParams;

  return (
    <>
      <header className="flex items-center px-6 py-5">
        <Logo size="nav" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 pb-16">
        <AuthCard mode="login" botUsername={botUsername} error={error} redirectTo={redirectTo} />
      </main>
    </>
  );
}
