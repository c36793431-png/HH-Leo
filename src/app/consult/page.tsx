import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { CONSULT_DASHBOARD_PATH } from "@/lib/consult-host";
import { Logo } from "@/components/logo";
import { ConsultApplyContent } from "@/components/consult/consult-apply-content";

/** The consult home, the root of consult.horizonhft.com (proxy.ts rewrite, lib/consult-host.ts; S2 marcus m71309): a
 * signed-in visitor goes to the provider dashboard, which shows their application or how to apply; a signed-out one
 * gets the application form and a way to sign in. Placeholder styling until Iris's design lands (marcus m71303). */
export default async function ConsultHomePage() {
  const session = await auth();
  if (session?.user?.id) redirect(CONSULT_DASHBOARD_PATH);

  return (
    <>
      <header className="flex items-center px-6 py-5">
        <Logo size="nav" />
      </header>
      <main className="flex-1 px-4 pb-20 pt-6">
        <ConsultApplyContent signInHref="/login" />
      </main>
    </>
  );
}
