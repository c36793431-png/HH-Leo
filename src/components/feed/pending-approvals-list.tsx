import { FeedRequestRowActions } from "@/components/feed/feed-request-row-actions";
import type { ActionResult } from "@/lib/action-result";
import type { FeedTierRequestRow } from "@/lib/feed-tier-requests";
import { formatRelative } from "@/lib/format-time";
import { groupRequestsByPackage } from "@/lib/request-package-groups";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** The provider panel's Approvals queue (feed/dashboard/users). A batch that makes up a package
 * renders as ONE row under the package's name with its member tiers inside, each keeping its own
 * Approve/Deny on its own envelope (coxwell 2026-09-29 via marcus m57786 (a); Source F: no
 * batch-level approve). Split out of the page so it renders from fixture rows. */
export function PendingApprovalsList({
  pending,
  approveAction,
  rejectAction,
}: {
  pending: FeedTierRequestRow[];
  approveAction: Action;
  rejectAction: Action;
}) {
  return (
    <div className="q">
      {groupRequestsByPackage(pending).map((g, i) => {
        const r = g.kind === "package" ? g.members[0] : g.row;
        return (
          <div className={`qrow${i === 0 ? " hi" : ""}`} key={g.kind === "package" ? `batch-${g.batchId}` : r.id}>
            <div className="qav">{(r.userEmail ?? "?").charAt(0).toUpperCase()}</div>
            <div className="qwho">
              <b>
                {r.userEmail ?? "unknown"} <span className="tb trial">🧪 Request</span>
              </b>
              <div className="meta">
                <em>{g.kind === "package" ? g.label : r.tierName}</em> · requested {formatRelative(r.createdAt)}
                {r.serverName ? ` · ${r.serverName}` : ""}
              </div>
            </div>
            {g.kind === "single" ? (
              <FeedRequestRowActions requestId={r.id} approveAction={approveAction} rejectAction={rejectAction} />
            ) : (
              <div className="qtiers">
                {g.members.map((m) => (
                  <div className="qtier" key={m.id}>
                    <span className="tn">
                      {m.tierName}
                      {m.serverName !== r.serverName && m.serverName ? ` · ${m.serverName}` : ""}
                    </span>
                    <FeedRequestRowActions requestId={m.id} approveAction={approveAction} rejectAction={rejectAction} />
                  </div>
                ))}
              </div>
            )}
            {i === 0 && (
              <div className="qexpand">
                {/* Written for the provider, no function names (marcus m64242, A1). "Each feed" because
                    every feed still has its own Approve until the one-click package approve (A2)
                    ships; that change rewrites this line. */}
                Approving a feed starts the client&apos;s trial on it. They get an email and a bot message, and
                access goes live.
                <div className="flow">
                  <span className="n act">You approve</span>
                  <span className="ar">→</span>
                  <span className="n">Client gets email + bot message</span>
                  <span className="ar">→</span>
                  <span className="n">Access live</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
