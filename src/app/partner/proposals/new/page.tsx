import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPartnerByUserId } from "@/lib/partners";
import { ProposalForm } from "@/components/partner/proposal-form";

export default async function NewProposalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const partner = await getPartnerByUserId(session.user.id);
  if (!partner) {
    return (
      <div className="rounded-xl border border-cyan-400/35 bg-cyan-950/60 p-6 text-sm text-zinc-400">
        No partner record is linked to this account yet.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col text-zinc-100">
      <header className="mb-6">
        <a href="/partner/dashboard" className="mb-3 inline-block text-xs text-cyan-400 hover:underline">
          ← Back
        </a>
        <h1 className="text-xl font-semibold">Propose a negotiated deal</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Set the client, the tiers they get, your suggested price and your revenue split. Horizon reviews every
          proposal before it activates — you can negotiate the terms in review.
        </p>
      </header>
      <ProposalForm />
    </div>
  );
}
