import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getBotUsername } from "@/lib/telegram-bot";
import { AuthCard } from "@/components/auth-card";

export default async function SignupPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

  const botUsername = await getBotUsername();

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <AuthCard mode="signup" botUsername={botUsername} />
    </main>
  );
}
