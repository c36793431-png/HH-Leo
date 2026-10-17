"use client";

import { startTransition, useActionState } from "react";
import { saveConsultantProfileAction, setConsultantProfilePublishedAction } from "@/app/consult/dashboard/actions";
import { ServiceTypesField } from "@/components/consult/service-types-field";
import type { ConsultServiceType } from "@/lib/consult-service-types";

const INPUT = "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200";

export interface ProfileEditorValues {
  slug: string;
  displayName: string;
  headline: string;
  about: string;
  serviceTypes: ConsultServiceType[];
  serviceOther: string | null;
  markets: string;
  platforms: string;
  languages: string;
}

/** The provider's profile form (S3; placeholder styling until Iris's design, marcus m71303). The limits come from the
 * page as a prop, as in consult-apply-form.tsx, so the lib's server imports stay out of the client bundle. */
export function ConsultProfileEditor({
  values,
  saved,
  limits: L,
}: {
  values: ProfileEditorValues;
  saved: boolean;
  limits: { displayName: number; headline: number; about: number; freeText: number };
}) {
  const [state, formAction, isPending] = useActionState(saveConsultantProfileAction, null);

  // Submitted by hand so a refusal (e.g. a taken address) keeps what was typed (consult-apply-form.tsx).
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <p className="sm:col-span-2 text-xs text-zinc-500">
        No prices, links or contact details: clients reach you through a request on Horizon.
      </p>
      <div>
        <label htmlFor="pf-name" className="block text-xs text-zinc-500">Name shown to clients</label>
        <input id="pf-name" name="displayName" required maxLength={L.displayName} defaultValue={values.displayName} disabled={isPending} className={INPUT} />
      </div>
      <div>
        <label htmlFor="pf-slug" className="block text-xs text-zinc-500">Profile address (lowercase, numbers, hyphens)</label>
        <input id="pf-slug" name="slug" required maxLength={64} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={values.slug} disabled={isPending} className={INPUT} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="pf-headline" className="block text-xs text-zinc-500">Headline</label>
        <input id="pf-headline" name="headline" required maxLength={L.headline} defaultValue={values.headline} disabled={isPending} className={INPUT} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="pf-about" className="block text-xs text-zinc-500">About you and what you do</label>
        <textarea id="pf-about" name="about" rows={5} required maxLength={L.about} defaultValue={values.about} disabled={isPending} className={INPUT} />
      </div>
      <ServiceTypesField idPrefix="pf" disabled={isPending} defaultTypes={values.serviceTypes} defaultOther={values.serviceOther ?? ""} />
      <div>
        <label htmlFor="pf-markets" className="block text-xs text-zinc-500">Markets (optional)</label>
        <input id="pf-markets" name="markets" maxLength={L.freeText} placeholder="Gold, indices, FX" defaultValue={values.markets} disabled={isPending} className={INPUT} />
      </div>
      <div>
        <label htmlFor="pf-platforms" className="block text-xs text-zinc-500">Platforms (optional)</label>
        <input id="pf-platforms" name="platforms" maxLength={L.freeText} placeholder="MT4, MT5, Horizon" defaultValue={values.platforms} disabled={isPending} className={INPUT} />
      </div>
      <div>
        <label htmlFor="pf-languages" className="block text-xs text-zinc-500">Languages (optional)</label>
        <input id="pf-languages" name="languages" maxLength={L.freeText} placeholder="English" defaultValue={values.languages} disabled={isPending} className={INPUT} />
      </div>
      <div className="sm:col-span-2">
        {state && !state.ok && <p className="mb-3 text-xs text-red-400">{state.error}</p>}
        {state?.ok && <p className="mb-3 text-xs text-emerald-300">Saved.</p>}
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-cyan-500/90 px-5 py-2.5 text-sm font-medium text-black hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : saved ? "Save changes" : "Create profile"}
        </button>
      </div>
    </form>
  );
}

/** The provider's own on/off switch for the marketplace. */
export function ConsultProfilePublishToggle({ published }: { published: boolean }) {
  const [state, formAction, isPending] = useActionState(setConsultantProfilePublishedAction, null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="published" value={published ? "false" : "true"} />
      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center justify-center rounded-md border border-cyan-500/40 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
      >
        {isPending ? "Saving…" : published ? "Hide from the marketplace" : "Show in the marketplace"}
      </button>
      {state && !state.ok && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
