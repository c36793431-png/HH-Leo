import { PACKAGE_TIER_KEYS, feedTierMeta } from "./feed-tier-catalogue";

export type RequestGroup<T> =
  | { kind: "package"; packageKey: string; label: string; batchId: string; members: T[] }
  | { kind: "single"; row: T };

/** DISPLAY grouping only, for the provider panel's Approvals list and the admin queue (coxwell
 * 2026-09-29, "these should be together under NY base package"; marcus m57786 (a)). It changes
 * no approval semantics: every member keeps its own Approve/Deny, and each of those is one
 * approveOnClient on one envelope in one transaction. batch_id stays "a grouping key only ... no
 * batch-level approve" (Source F, docs/specs/0086-phase2-ledger-extract.md:59).
 *
 * A batch reads as a package when the tier set of its rows IN `rows` equals PACKAGE_TIER_KEYS[x]
 * exactly. The batch itself does not record that it was a package (createFeedTierRequest expands
 * the key before writing), so this is derived, and a client who picked the same tiers by hand
 * reads as the package too (accepted, m57786). Only the rows passed in count: a member the caller
 * filtered out (another status, a tier this provider does not own) breaks the set, and the rest
 * render as single rows rather than under a label that names a tier which isn't shown.
 *
 * Order is kept: a package renders where its first member appeared, members in the
 * PACKAGE_TIER_KEYS order the label names them in. */
export function groupRequestsByPackage<T extends { batchId: string; tierKey: string }>(rows: T[]): RequestGroup<T>[] {
  const byBatch = new Map<string, T[]>();
  for (const row of rows) {
    const batch = byBatch.get(row.batchId);
    if (batch) batch.push(row);
    else byBatch.set(row.batchId, [row]);
  }

  const packageOf = new Map<string, string>();
  for (const [batchId, batch] of byBatch) {
    const keys = new Set(batch.map((r) => r.tierKey));
    if (keys.size !== batch.length) continue;
    for (const [packageKey, members] of Object.entries(PACKAGE_TIER_KEYS)) {
      if (members.length === keys.size && members.every((k) => keys.has(k))) {
        packageOf.set(batchId, packageKey);
        break;
      }
    }
  }

  const groups: RequestGroup<T>[] = [];
  const emitted = new Set<string>();
  for (const row of rows) {
    const packageKey = packageOf.get(row.batchId);
    if (!packageKey) {
      groups.push({ kind: "single", row });
      continue;
    }
    if (emitted.has(row.batchId)) continue;
    emitted.add(row.batchId);
    const order = PACKAGE_TIER_KEYS[packageKey];
    const members = [...byBatch.get(row.batchId)!].sort((a, b) => order.indexOf(a.tierKey) - order.indexOf(b.tierKey));
    groups.push({
      kind: "package",
      packageKey,
      label: feedTierMeta(packageKey)?.name ?? packageKey,
      batchId: row.batchId,
      members,
    });
  }
  return groups;
}
