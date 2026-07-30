import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";
import { Logo } from "@/components/logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/dashboard");

  const botUsername = await getBotUsername();
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-16">
      <Logo size="hero" />
      <AuthCard mode="login" botUsername={botUsername} error={error} />
    </main>
  );
}
