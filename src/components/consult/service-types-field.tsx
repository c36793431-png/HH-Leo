"use client";

import { useState } from "react";
import { CONSULT_SERVICE_OTHER_MAX, CONSULT_SERVICE_TYPES, CONSULT_SERVICE_TYPE_LABELS, type ConsultServiceType } from "@/lib/consult-service-types";

const INPUT = "mt-1 w-full rounded border border-zinc-700 bg-black/40 px-2 py-1.5 text-sm text-zinc-200";

/** The services a provider offers (0116; consult-service-types.ts): one checkbox per type, posted as repeated
 * "serviceTypes", and the "serviceOther" name, shown and required while Other is ticked. The server re-checks all of it
 * (parseConsultServiceTypes). Shared by the apply form and the profile editor. */
export function ServiceTypesField({
  disabled,
  defaultTypes = [],
  defaultOther = "",
  idPrefix,
}: {
  disabled?: boolean;
  defaultTypes?: ConsultServiceType[];
  defaultOther?: string;
  idPrefix: string;
}) {
  const [otherOn, setOtherOn] = useState(defaultTypes.includes("other"));
  return (
    <fieldset className="sm:col-span-2">
      <legend className="block text-xs text-zinc-500">Services you offer (choose at least one)</legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {CONSULT_SERVICE_TYPES.map((t) => (
          <label key={t} htmlFor={`${idPrefix}-type-${t}`} className="inline-flex items-center gap-2 text-sm text-zinc-300">
            <input
              id={`${idPrefix}-type-${t}`}
              type="checkbox"
              name="serviceTypes"
              value={t}
              defaultChecked={defaultTypes.includes(t)}
              disabled={disabled}
              onChange={t === "other" ? (e) => setOtherOn(e.currentTarget.checked) : undefined}
            />
            {CONSULT_SERVICE_TYPE_LABELS[t]}
          </label>
        ))}
      </div>
      {otherOn && (
        <div className="mt-3">
          <label htmlFor={`${idPrefix}-other`} className="block text-xs text-zinc-500">Other service</label>
          <input id={`${idPrefix}-other`} name="serviceOther" type="text" required maxLength={CONSULT_SERVICE_OTHER_MAX} defaultValue={defaultOther} disabled={disabled} className={INPUT} />
        </div>
      )}
    </fieldset>
  );
}
