"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { ServerRegistration } from "@/lib/server-registration";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { ServerRegistrationForm } from "./server-registration-form";

interface ServerRegistrationViewProps {
  registration: ServerRegistration;
  action: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}

export function ServerRegistrationView({ registration, action }: ServerRegistrationViewProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <ServerRegistrationForm
        action={action}
        value={registration}
        onSaved={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div>
      <div className="srv-eyebrow">📍 {registration.serverLocation}</div>
      <div className="srv-panel">
        <div className="srv-rfld">
          <div className="srv-k">Server name</div>
          <div className="srv-v">{registration.serverName}</div>
        </div>
        <div className="srv-rfld">
          <div className="srv-k">VPS provider</div>
          <div className="srv-v">
            {registration.vpsProvider}
            {registration.vpsProviderOther ? <span className="srv-dim"> · {registration.vpsProviderOther}</span> : null}
          </div>
        </div>
        <div className="srv-rfld">
          <div className="srv-k">Server location</div>
          <div className="srv-v">{registration.serverLocation}</div>
        </div>
        <div className="srv-rfld">
          <div className="srv-k">Server IP</div>
          <div className="srv-v mono">{registration.declaredIp}</div>
        </div>
      </div>
      <div className="srv-foot">
        <span className="stamp">Last updated {formatAbsoluteUtc(registration.updatedAt)}</span>
        <span className="spacer" />
        <button type="button" className="btn mute sm" onClick={() => setEditing(true)}>
          ✎ Edit
        </button>
      </div>
    </div>
  );
}
