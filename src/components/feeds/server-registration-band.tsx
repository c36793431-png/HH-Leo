import Link from "next/link";
import type { ServerRegistration } from "@/lib/server-registration";

export function ServerRegistrationBand({ registration }: { registration: ServerRegistration }) {
  return (
    <div className="ftd-server-banner">
      <span className="lbl" role="img" aria-label="Server">🖥</span>
      <span className="val">{registration.serverName}</span>
      <span className="val">
        ·{" "}
        {registration.vpsProviderOther
          ? `${registration.vpsProvider} (${registration.vpsProviderOther})`
          : registration.vpsProvider}
      </span>
      <span className="val">· {registration.declaredIp}</span>
      <span className="verified">✓ Verified</span>
      <Link href="/account/servers" className="change-link">
        Change server →
      </Link>
    </div>
  );
}
