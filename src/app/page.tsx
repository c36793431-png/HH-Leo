import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Logo } from "@/components/logo";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/dashboard");

  return (
    <>
      <header className="flex items-center px-6 py-5">
        <Logo size="nav" href="/" />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-16 text-center">
        <Logo size="hero" href={null} />
        <p className="max-w-md text-sm text-zinc-400">
          Arbitrage execution software, licenses, and updates for Horizon HFT clients.
        </p>
        <div className="flex gap-4">
          <a
            href="/login"
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-500"
          >
            Log in
          </a>
          <a
            href="/signup"
            className="rounded-md bg-cyan-500/90 px-4 py-2 text-sm font-medium text-black hover:bg-cyan-400"
          >
            Sign up free
          </a>
        </div>
      </main>
    </>
  );
}
