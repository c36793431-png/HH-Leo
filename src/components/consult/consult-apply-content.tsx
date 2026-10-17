import { CONSULTANT_APPLICATION_LIMITS } from "@/lib/consultant-applications";
import { ConsultApplyForm } from "@/components/consult/consult-apply-form";

/** The application heading and form, shared by /consult/apply and the consult home (S2). Placeholder styling until
 * Iris's design for the public consult pages lands (marcus m71303). */
export function ConsultApplyContent({ signInHref }: { signInHref?: string }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">SERVICE PROVIDERS</div>
        <h1 className="mt-2 text-3xl font-bold text-zinc-50">Offer your services through Horizon HFT</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Consulting, coding and development, setup and installation, and more.
          Every application is reviewed before anything is public, and we reply by email.
        </p>
        {signInHref && (
          <p className="mt-3 text-sm text-zinc-400">
            Already applied?{" "}
            <a href={signInHref} className="text-cyan-400 hover:text-cyan-300">
              Sign in
            </a>{" "}
            with the email you applied with to see your status.
          </p>
        )}
      </div>
      <ConsultApplyForm limits={CONSULTANT_APPLICATION_LIMITS} />
    </div>
  );
}
