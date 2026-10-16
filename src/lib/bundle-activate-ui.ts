import type { BundleActivateState } from "./admin-bundle-activate";

/** Pure helpers for the admin "Activate bundle…" dialog (components/admin/bundle-activate-form.tsx), kept out of the
 * "use client" file so they stay plain functions (lint rule local/no-non-component-client-exports). */

/** Activate stays off while a request runs, before a Check, and while any refusal shows. The server re-plans on
 * Activate regardless (lib/admin-bundle-activate.ts), so this only spares a refused round trip. */
export function activateDisabled(pending: boolean, state: BundleActivateState): boolean {
  return pending || state?.kind !== "plan" || state.refusals.length > 0;
}

/** The CLI's "Pass --allow-… to …" hint means nothing in the dialog; its tickbox says it instead. */
export function refusalText(text: string): string {
  return text.replace(/\.?\s*Pass --allow-[a-z-]+ to .*$/, "");
}
