"use client";

import { useTransition } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { ServerRegistration } from "@/lib/server-registration";
import { emitToast } from "@/lib/toast-bus";

export interface UnlinkedServerEntry {
  registration: ServerRegistration;
  /** One per licence on the account that has no server yet, each bound server-side to
   * (this row, that licence). Empty when every licence already has a server. */
  links: { licenseKey: string; action: () => Promise<ActionResult> }[];
}

function LinkButton({ licenseKey, action }: UnlinkedServerEntry["links"][number]) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn ghost sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await action();
          if (result.ok) emitToast("Server linked to your licence", "success");
          else emitToast(result.error, "error");
        })
      }
    >
      {isPending ? "Linking…" : `Use for licence ${licenseKey}`}
    </button>
  );
}

/** Servers registered before the account had a licence (marcus m65584 Q-S2, plan R1). They
 * sit outside the licence cards because nothing licence-keyed reads them; "Use for licence"
 * links one to a licence that has no server yet, so the client doesn't register it twice. */
export function UnlinkedServersCard({ entries }: { entries: UnlinkedServerEntry[] }) {
  return (
    <div className="card full">
      <div className="chead">
        <span className="ic">🖥</span>
        <h3>Not linked to a licence</h3>
      </div>
      <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
        You registered these before you had a licence. Link one to a licence to use it for feeds.
      </p>
      <div className="srv-grows">
        {entries.map(({ registration, links }) => (
          <div className="srv-srow" key={registration.id}>
            <span className="srv-ic">🖥</span>
            <span className="srv-sname">{registration.serverName}</span>
            <span className="srv-sprov">{registration.serverLocation}</span>
            <span className="srv-sip">{registration.declaredIp}</span>
            {links.length > 0 ? (
              links.map((link) => <LinkButton key={link.licenseKey} {...link} />)
            ) : (
              <span className="srv-sprov">Every licence already has a server</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
