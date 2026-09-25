/* N connection endpoints per provider tier: the one module that owns provider_tier_endpoints
 * and provider_tier_proposal_endpoints.
 *
 * Spec: docs/specs/0091-tier-endpoints-design.md @ 6100dc0 (kai, thread
 * provider-tier-endpoints-2026-09-24; fable's rulings relayed by marcus at m53845, m53894,
 * m53938, m53977). Section and line cites below are into that file at that sha. The schema is
 * docs/specs/0091_provider_tier_endpoints.sql @ 1f649a9 (child DDL :113-155), a candidate for
 * coxwell, not yet under db/migrations.
 *
 * This delta (code phase delta 1) holds the pure functions only: the parser, the submit-time
 * guard (clauses 1 and 2), the verification carry and the reader's viewer predicate. The SQL
 * reader and writers (design section 4, :264-271) come in a later delta and are the only place
 * the table names may appear outside this file's tests and the migration text (grep gate,
 * :272-287). */

/** One endpoint row as the app writes it: the four connection columns plus the provider's
 * note, at a 0-based position. Port stays text because the parent column is text today
 * (design 2, :59-61). `null` is "not supplied"; the parser never emits ''. */
export interface EndpointInput {
  position: number;
  protocol: string | null;
  endpointHost: string | null;
  endpointPort: string | null;
  compid: string | null;
  notes: string | null;
}

/** A provider_tier_endpoints row: an EndpointInput plus the per-row verified claim, which is
 * "a claim about this tier's specific endpoint_host:endpoint_port, not about the row"
 * (src/lib/provider-tiers.ts:117-118, quoted at design 2 item 1, :65-68). */
export interface LiveEndpoint extends EndpointInput {
  endpointVerified: boolean;
}

/** The four connection columns, the part of a row the two keys of design 2.1 are defined over. */
type ConnectionFour = Pick<EndpointInput, "protocol" | "endpointHost" | "endpointPort" | "compid">;

/** Cap per parent. Mirrors the DB check `position between 0 and 7` on both child tables
 * (0091 .sql :124, :148; design 2.2, :169-171) so the provider reads a sentence, not a
 * constraint name. */
export const MAX_ENDPOINTS_PER_PARENT = 8;

/** Labels as the provider sees them on the terms form (tier-proposal-form.tsx:56, :60, :67,
 * :71), for the same reason provider-tier-proposals.ts:211-213 gives: an error that says
 * "compid" when the box is labelled "SenderCompID" sends them hunting for a field that isn't
 * there. */
const LABEL = {
  protocol: "Protocol",
  compid: "SenderCompID",
  endpointHost: "Endpoint host",
  endpointPort: "Endpoint port",
} as const;

function isSet(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== "";
}

/** "host:port" for the refusal echo. A live row with neither is a backfilled address-less
 * parent (design 2.1, :104-123) and renders as "(no address)", never as an empty string or a
 * bare colon (marcus m53979 relaying fable m53977, note N2). One half missing names the half
 * that is there and says which is missing, so the provider can tell the two apart. */
function describeAddress(row: ConnectionFour): string {
  const host = isSet(row.endpointHost) ? row.endpointHost.trim() : null;
  const port = isSet(row.endpointPort) ? row.endpointPort.trim() : null;
  if (host === null && port === null) return "(no address)";
  return `${host ?? "(no host)"}:${port ?? "(no port)"}`;
}

/** Clause 1's removal key, `(host, port)` (design 2.1, :124-129). Defined only on rows that
 * have both: a submitted row can never lack them once parseEndpointsJson has run (design 2.1
 * :104-113), and a live row lacking either is un-matchable on purpose, so it is reported as
 * missing rather than matched to whatever else has no address. Keyed on the trimmed value, as
 * isSet tests it (fable delta-1 note N1, m54026 via marcus m54028): a backfilled live row with
 * a leading space would otherwise never match the parser's trimmed submission. */
function addressKey(row: ConnectionFour): string | null {
  if (!isSet(row.endpointHost) || !isSet(row.endpointPort)) return null;
  return `${row.endpointHost.trim()}\u0000${row.endpointPort.trim()}`;
}

/** Row identity and the carry key: the four coalesced to '' (design 2.1, :84-91), the same
 * expression as the identity index in the .sql (:129-131, :153-155) except that this one trims
 * (N1, as addressKey). The parser never emits untrimmed or whitespace-only values, so the two
 * diverge only on backfilled rows. Notes are not identity. */
function identityKey(row: ConnectionFour): string {
  return [row.protocol, row.endpointHost, row.endpointPort, row.compid]
    .map((v) => (isSet(v) ? v.trim() : ""))
    .join("\u0000");
}

/** Bucket rows by addressKey. Rows with no key (address-less live rows) bucket under their
 * description instead, so however many there are the address is echoed once (N2); the sentinel
 * never collides with a real key because a real key always contains \u0000. */
function groupByAddress(rows: readonly ConnectionFour[], keepKeyless: boolean): Map<string, ConnectionFour[]> {
  const groups = new Map<string, ConnectionFour[]>();
  for (const r of rows) {
    const key = addressKey(r);
    if (key === null && !keepKeyless) continue;
    const groupKey = key ?? `\u0001${describeAddress(r)}`;
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(r);
    else groups.set(groupKey, [r]);
  }
  return groups;
}

/** The submit-time guard, replacing the per-column connectionFieldsThatWouldClear for the
 * four connection columns (provider-tier-proposals.ts:243-247). Pure and exported apart from
 * the query it feeds, for the reason given there: keeping the decision free of the lookup is
 * what makes it checkable without a live row.
 *
 * Returns one string per refusal, in the wording pattern of provider-tier-proposals.ts:318-319;
 * a non-empty result is a refusal. Two clauses, design 2.1:
 *
 * - Clause 1 (:124-129): every live `(host, port)` must be present in the submission's set of
 *   `(host, port)`; a missing one is described as `host:port`, once per address. The removal
 *   key decides WHICH live row a submitted row is talking about.
 * - Clause 2 (:130-142): on a live row matched by `(host, port)`, `protocol` or `compid` going
 *   from set to blank is refused, the echo naming the column's label and the address, never the
 *   note and never the live value. Set -> different value is an edit (allowed, re-verifies by
 *   the carry); null -> set is an add.
 *
 * Where n > 1 live sessions share one address (design 2.1 names one host:port serving a BJF and
 * a cTrader session), both clauses are COUNTS per address, fable's delta-1 strike S1 (m54026 via
 * marcus m54028): (i) fewer submitted rows at the address than live rows is a removal, echoed
 * as "<k> of <n> endpoints removed at host:port"; (ii) otherwise, per column, fewer submitted
 * rows with it set than live rows with it set is a narrowing. For n = 1 this is the same
 * decision as the clauses above. The "kept if ANY submitted row has it set" rule that stood at
 * 2b183a4 let one verified session vanish behind its neighbour, which is the removal this guard
 * exists to refuse. When (i) fires, (ii) is not evaluated for that address: the row count is
 * the thing to fix first, and a column count against a short set would only echo noise.
 *
 * The two keys are not the same key and must not be harmonised (:143-147). */
export function endpointsThatWouldClear(
  liveRows: readonly ConnectionFour[],
  submitted: readonly ConnectionFour[]
): string[] {
  const submittedByAddress = groupByAddress(submitted, false);
  const liveByAddress = groupByAddress(liveRows, true);

  const refusals: string[] = [];
  for (const [key, liveAtAddress] of liveByAddress) {
    const address = describeAddress(liveAtAddress[0]);
    const submittedAtAddress = submittedByAddress.get(key) ?? [];
    if (submittedAtAddress.length === 0) {
      refusals.push(address);
      continue;
    }
    if (submittedAtAddress.length < liveAtAddress.length) {
      const removed = liveAtAddress.length - submittedAtAddress.length;
      refusals.push(`${removed} of ${liveAtAddress.length} endpoints removed at ${address}`);
      continue;
    }
    for (const column of ["protocol", "compid"] as const) {
      const liveSet = liveAtAddress.filter((r) => isSet(r[column])).length;
      const submittedSet = submittedAtAddress.filter((s) => isSet(s[column])).length;
      if (submittedSet < liveSet) {
        refusals.push(`${LABEL[column]} left blank at ${address}`);
      }
    }
  }
  return refusals;
}

/** Verification carry for the confirm's replace-set (design 2.1 first bullet, :93-100; 2.2,
 * :154-158). A row of `after` is verified iff some row of `before` with the same four-tuple
 * (coalesced, null equal to null) was verified. Keyed on the four and not on `(host, port)`:
 * a FIX logon is an address plus a session identity, so a verified claim does not survive a
 * compid or protocol change. Tightening versus today, on purpose (:101-103): the UPDATE at
 * provider-tier-proposals.ts:494-499 keeps `verified = true` across a compid-only edit; this
 * does not. Computed from the pre-delete snapshot, never by position (N3, :154-157). */
export function carryVerification(
  before: readonly LiveEndpoint[],
  after: readonly EndpointInput[]
): LiveEndpoint[] {
  const verified = new Set<string>();
  for (const b of before) if (b.endpointVerified) verified.add(identityKey(b));
  return after.map((row) => ({ ...row, endpointVerified: verified.has(identityKey(row)) }));
}

/** Wire shape of one row as the terms form and the register-provider form post it, JSON in a
 * hidden input. Every field optional and string-or-null; anything else is refused by row. */
interface RawEndpointRow {
  protocol?: string | null;
  endpointHost?: string | null;
  endpointPort?: string | null;
  compid?: string | null;
  notes?: string | null;
}

function cleanField(row: RawEndpointRow, key: keyof RawEndpointRow, rowNo: number): string | null {
  const value = row[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`Endpoint row ${rowNo}: ${key} must be text.`);
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Parser for the terms action and the register-provider action (design 5 item 3, :328-332).
 * Drops all-blank rows, assigns positions 0..n-1 in source order, refuses more than
 * MAX_ENDPOINTS_PER_PARENT rows (counted after the blanks are dropped: a blank is not a row),
 * refuses a row with only `notes`, and refuses a row missing host or port, naming the missing
 * column(s). Row numbers in errors are 1-based source indexes, blanks included, so they match
 * what the provider sees on the form.
 *
 * The host-and-port rule is fable's design verdict S1 (m53938 via m53940; design 2.1,
 * :104-123): clause 1 keys on `(host, port)`, and an address-less row would match every other
 * address-less row, so the guard would silently pass a removal. Tightening versus today, on
 * purpose (:113-115): terms/actions.ts:48-51 accepts a protocol or a compid with no address. */
export function parseEndpointsJson(raw: string | null | undefined): EndpointInput[] {
  const text = (raw ?? "").trim();
  if (text === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Endpoints could not be read. Reload the form and try again.");
  }
  if (!Array.isArray(parsed)) throw new Error("Endpoints must be a list.");

  const rows: EndpointInput[] = [];
  parsed.forEach((item: unknown, index) => {
    const rowNo = index + 1;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Endpoint row ${rowNo} is not a row.`);
    }
    const rawRow = item as RawEndpointRow;
    const protocol = cleanField(rawRow, "protocol", rowNo);
    const endpointHost = cleanField(rawRow, "endpointHost", rowNo);
    const endpointPort = cleanField(rawRow, "endpointPort", rowNo);
    const compid = cleanField(rawRow, "compid", rowNo);
    const notes = cleanField(rawRow, "notes", rowNo);

    const anyConnection = [protocol, endpointHost, endpointPort, compid].some((v) => v !== null);
    if (!anyConnection) {
      if (notes !== null) {
        throw new Error(`Endpoint row ${rowNo} has notes but no connection details. Add the address or clear the note.`);
      }
      return; // all blank: not a row
    }

    const missing: string[] = [];
    if (endpointHost === null) missing.push(LABEL.endpointHost);
    if (endpointPort === null) missing.push(LABEL.endpointPort);
    if (missing.length) {
      throw new Error(`Endpoint row ${rowNo} needs ${missing.join(" and ")}: an endpoint is a host and a port.`);
    }

    rows.push({ position: rows.length, protocol, endpointHost, endpointPort, compid, notes });
  });

  if (rows.length > MAX_ENDPOINTS_PER_PARENT) {
    throw new Error(`At most ${MAX_ENDPOINTS_PER_PARENT} endpoints per tier (you entered ${rows.length}).`);
  }
  return rows;
}

/** Who is asking. `userId` null = no session. `isAdmin` is the caller's already-resolved
 * admin check, passed in so this predicate has no dependency to mock. */
export interface EndpointViewer {
  userId: string | null;
  isAdmin: boolean;
}

export class EndpointViewerError extends Error {
  constructor() {
    super("Not allowed to read connection endpoints for this tier.");
    this.name = "EndpointViewerError";
  }
}

/** The one reader's control decision, as a pure predicate (design 4 [S3], :264-271 and
 * :288-291): an admin, or the owning provider of the parent, whose `ownerUserId` the reader
 * re-reads from the row and never from a posted id (the assertOwnsApplication shape,
 * provider-tier-proposals.ts:187-194). A parent with no owner admits only an admin. Any future
 * buyer-facing read of these tables has to change this function, not a render. */
export function endpointViewerAllowed(viewer: EndpointViewer, ownerUserId: string | null): boolean {
  if (viewer.isAdmin) return true;
  return viewer.userId !== null && ownerUserId !== null && viewer.userId === ownerUserId;
}

/** Throws before any query runs when endpointViewerAllowed is false. The SQL reader (later
 * delta) calls this once per parent it was asked for. */
export function assertEndpointViewer(viewer: EndpointViewer, ownerUserId: string | null): void {
  if (!endpointViewerAllowed(viewer, ownerUserId)) throw new EndpointViewerError();
}
