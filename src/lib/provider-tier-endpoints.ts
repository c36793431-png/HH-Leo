/* N connection endpoints per provider tier: the one module that owns provider_tier_endpoints
 * and provider_tier_proposal_endpoints.
 *
 * Spec: docs/specs/0091-tier-endpoints-design.md @ 6100dc0 (kai, thread
 * provider-tier-endpoints-2026-09-24; fable's rulings relayed by marcus at m53845, m53894,
 * m53938, m53977). Section and line cites below are into that file at that sha. The schema is
 * docs/specs/0091_provider_tier_endpoints.sql @ 1f649a9 (child DDL :113-155), a candidate for
 * coxwell, not yet under db/migrations.
 *
 * Delta 1 holds the pure functions: the parser, the submit-time guard (clauses 1 and 2), the
 * verification carry and the reader's viewer predicate. Delta 2 adds the SQL: the one reader
 * (design section 4, :264-271), the two writers and the position-0 parent mirror (section 3
 * step 2, :203-209). This file is the only place the table names may appear outside its tests
 * and the migration text (grep gate, :272-287). The reader and writers take a Queryable, never
 * the pool: every SQL here runs on whatever the caller is inside, so a writer is always in the
 * caller's transaction and never opens one of its own. */
import type { QueryResult, QueryResultRow } from "@neondatabase/serverless";

/** Pool or transaction client, structural (the feed-tier-trials.ts:114 shape) so a caller
 * inside an open transaction sees its own uncommitted writes. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

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
 * (src/lib/provider-tiers.ts:117-118 at 030d5c8, quoted at design 2 item 1, :65-68; that
 * comment left provider-tiers.ts with the parent-column fields at delta 3 and lives here now). */
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

/** One row as a form holds it before it is posted: whatever a controlled input or a JSON
 * round-trip left in the field. A number is the case that matters (fable's delta-1 note N3,
 * m54026 via marcus m54028: cleanField refuses a numeric port as a row-level "must be text"). */
export interface EndpointRowDraft {
  protocol?: string | number | null;
  endpointHost?: string | number | null;
  endpointPort?: string | number | null;
  compid?: string | number | null;
  notes?: string | number | null;
}

/** The hidden-input serializer, the only way a form should build the JSON parseEndpointsJson
 * reads. Every present field is stringified, null and undefined stay null, so a port typed as
 * 9443 reaches the parser as "9443" and not as a refused number (N3). Pure and exported so the
 * contract is a test, not a hope about two client components. Rows are kept in order and none
 * is dropped: blank rows are the parser's to skip, so row numbers in its errors still match
 * the form. */
export function serializeEndpointRows(rows: readonly EndpointRowDraft[]): string {
  const asText = (v: string | number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));
  const wire: RawEndpointRow[] = rows.map((r) => ({
    protocol: asText(r.protocol),
    endpointHost: asText(r.endpointHost),
    endpointPort: asText(r.endpointPort),
    compid: asText(r.compid),
    notes: asText(r.notes),
  }));
  return JSON.stringify(wire);
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
  const seen = new Map<string, number>();
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

    // A repeated identity (same four, notes aside) is refused here by row number rather than
    // left to the writer, where the UNIQUE identity index (0091 .sql :129-131, :153-155) would
    // refuse it as a bare constraint error the provider cannot read. Not a second source of
    // truth: the index still holds, this is the same message the guard gives for the other
    // refusals (fable's delta-1 follow-on note N1, m54051 via marcus m54053). Without it a
    // submission [A, A] against live [A, B] counts as two rows at A's address, passes the
    // per-address guard, and drops B.
    const identity = identityKey({ protocol, endpointHost, endpointPort, compid });
    const firstRowNo = seen.get(identity);
    if (firstRowNo !== undefined) {
      throw new Error(`Endpoint row ${rowNo} repeats row ${firstRowNo}. Remove one, or make them different endpoints.`);
    }
    seen.set(identity, rowNo);

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

/** Throws before any query runs when endpointViewerAllowed is false. readEndpoints calls this
 * once per parent it was asked for. */
export function assertEndpointViewer(viewer: EndpointViewer, ownerUserId: string | null): void {
  if (!endpointViewerAllowed(viewer, ownerUserId)) throw new EndpointViewerError();
}

/** The application-grain connection details as provider_applications captured them (0059:
 * one set per provider, never per tier; src/lib/provider-tiers.ts ApplicationConnectionDetails).
 * Structural, so this module does not import provider-tiers.ts, which imports the pool. */
export interface ApplicationEndpointSource {
  protocol: string | null;
  host: string | null;
  port: string | null;
  compid: string | null;
}

/** One entry of the admin Connection details block (section 1 row 7). Either a tier's own
 * child row, or the application's one address standing in for a tier that has no rows. */
export interface DisplayEndpoint {
  /** The child row's position, or null for the application fallback. */
  position: number | null;
  protocol: string | null;
  endpointHost: string | null;
  endpointPort: string | null;
  compid: string | null;
  /** Provider-authored, rendered to admins only (design 2.2, :172-177); null on the fallback. */
  notes: string | null;
  /** The row's own claim, or null = withheld: a verified flag is about a tier's specific
   * host:port and must never be shown against an address sourced from the application. */
  endpointVerified: boolean | null;
  fromApplication: boolean;
}

/** '' is absent here, as in the page's pickScalar it replaces (admin/providers/page.tsx:57-67
 * at 030d5c8): register-provider submits blank inputs as "" rather than null. */
function presentOrNull(value: string | null): string | null {
  return isSet(value) ? value : null;
}

/** The N-endpoint successor of pickEndpoint (design 5 item 4, :333-336): zero tier rows render
 * as the application fallback, one or more render as the list, and the two grains never mix.
 * No mixing means no per-field fallback either: a tier row whose protocol or compid is null
 * shows null even when the application has a value, where pickScalar at 030d5c8 filled the gap
 * from the application per field. Reason: a row's four are one session's identity (design 2.1,
 * :84-91); an application protocol pasted onto a tier row's host:port is a session that was
 * never captured at either grain, the same fabrication pickEndpoint refused for host and port.
 * Pure, so both branches are tests. Rows come back in position order whatever order they
 * arrived in. */
export function resolveEndpointsForDisplay(
  tierEndpoints: readonly LiveEndpoint[],
  app: ApplicationEndpointSource
): DisplayEndpoint[] {
  if (tierEndpoints.length > 0) {
    return [...tierEndpoints]
      .sort((a, b) => a.position - b.position)
      .map((r) => ({
        position: r.position,
        protocol: r.protocol,
        endpointHost: r.endpointHost,
        endpointPort: r.endpointPort,
        compid: r.compid,
        notes: r.notes,
        endpointVerified: r.endpointVerified,
        fromApplication: false,
      }));
  }
  const fallback = {
    protocol: presentOrNull(app.protocol),
    endpointHost: presentOrNull(app.host),
    endpointPort: presentOrNull(app.port),
    compid: presentOrNull(app.compid),
  };
  if (Object.values(fallback).every((v) => v === null)) return [];
  return [{ position: null, ...fallback, notes: null, endpointVerified: null, fromApplication: true }];
}

/* ====================================================================================== SQL
 * Code phase delta 2. Everything below names the two child tables; nothing above does, and no
 * file outside this one may (design 4, grep gate (a), :275-277). */

export type EndpointParentKind = "tier" | "proposal";

/** The two parents, same child shape each (design 2, :54-61). The child table and its foreign
 * key are looked up by kind so the reader is one function (fable's delta-2 plan ruling J2,
 * m54043 via marcus m54049: one entry point whose viewer assert runs on both kinds). */
const PARENT = {
  tier: { table: "provider_tier_endpoints", parentTable: "provider_tiers", fk: "tier_id" },
  proposal: { table: "provider_tier_proposal_endpoints", parentTable: "provider_tier_proposals", fk: "proposal_id" },
} as const;

interface ChildRow {
  parent_id: string;
  position: number;
  protocol: string | null;
  endpoint_host: string | null;
  endpoint_port: string | null;
  compid: string | null;
  notes: string | null;
  endpoint_verified?: boolean;
}

function mapInput(r: ChildRow): EndpointInput {
  return {
    position: r.position,
    protocol: r.protocol,
    endpointHost: r.endpoint_host,
    endpointPort: r.endpoint_port,
    compid: r.compid,
    notes: r.notes,
  };
}

function mapLive(r: ChildRow): LiveEndpoint {
  // provider_tier_endpoints.endpoint_verified is `not null default false` (0091 .sql :145);
  // it is undefined here only when the row came from the proposal table, which never maps
  // through this function.
  return { ...mapInput(r), endpointVerified: r.endpoint_verified ?? false };
}

/** The ONE reader (design 4 [S3], :264-271). For every requested parent id the owner is
 * re-read from the parent row's application (`provider_applications.user_id`, the same source
 * assertOwnsApplication reads at provider-tier-proposals.ts:187-194) and assertEndpointViewer
 * runs BEFORE any SELECT on the child table. An id with no parent row has owner null and so
 * admits only an admin, who gets an empty list; a non-admin gets the same refusal as for a
 * parent they do not own, so this is not an existence oracle. The result has one entry per
 * requested id, rows in position order, an empty list for a parent with no rows. */
export async function readEndpoints(
  q: Queryable,
  viewer: EndpointViewer,
  parent: { kind: "tier"; ids: readonly string[] }
): Promise<Map<string, LiveEndpoint[]>>;
export async function readEndpoints(
  q: Queryable,
  viewer: EndpointViewer,
  parent: { kind: "proposal"; ids: readonly string[] }
): Promise<Map<string, EndpointInput[]>>;
export async function readEndpoints(
  q: Queryable,
  viewer: EndpointViewer,
  parent: { kind: EndpointParentKind; ids: readonly string[] }
): Promise<Map<string, LiveEndpoint[]> | Map<string, EndpointInput[]>> {
  const ids = Array.from(new Set(parent.ids));
  if (ids.length === 0) return new Map<string, EndpointInput[]>();
  const spec = PARENT[parent.kind];

  const owners = await q.query<{ id: string; owner_user_id: string | null }>(
    `select p.id, pa.user_id as owner_user_id
       from ${spec.parentTable} p
       join provider_applications pa on pa.id = p.application_id
      where p.id = any($1::uuid[])`,
    [ids]
  );
  const ownerById = new Map(owners.rows.map((r) => [r.id, r.owner_user_id]));
  for (const id of ids) assertEndpointViewer(viewer, ownerById.get(id) ?? null);

  const verifiedColumn = parent.kind === "tier" ? ", endpoint_verified" : "";
  const rows = await q.query<ChildRow>(
    `select ${spec.fk} as parent_id, position, protocol, endpoint_host, endpoint_port, compid, notes${verifiedColumn}
       from ${spec.table}
      where ${spec.fk} = any($1::uuid[])
      order by ${spec.fk}, position`,
    [ids]
  );
  return foldEndpointRows(
    ids,
    rows.rows.map((r) => ({ parentId: r.parent_id, endpoint: parent.kind === "tier" ? mapLive(r) : mapInput(r) }))
  );
}

/** The reader's row -> Map fold, pure (fable's delta-2 plan ruling J2(iii), m54043 via marcus
 * m54049): EVERY requested id gets an entry, an empty list for a parent with no rows, so a
 * caller cannot mistake "not looked up" for "no endpoints". Rows are appended in the order
 * given (the SELECT orders by position). A row for an id that was not requested is dropped;
 * the SELECT's `= any($1)` never produces one. */
export function foldEndpointRows<T>(
  ids: readonly string[],
  rows: ReadonlyArray<{ parentId: string; endpoint: T }>
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const id of ids) out.set(id, []);
  for (const r of rows) {
    const list = out.get(r.parentId);
    if (list) list.push(r.endpoint);
  }
  return out;
}

/** What the parent's columns must read while the dual-write is on (design 3 step 2, :203-209):
 * the row whose `position === 0` (its four, plus its verified flag on the tier side), or all
 * null and false when the parent has no such row. Position 0 means the row AT position 0, not
 * the first of the ordered array (fable's delta-2 plan ruling A2, m54043 via marcus m54049):
 * the app always writes a 0, coxwell SQL need not, and the 0092 gate compares the parent to the
 * position-0 child, so a parent with rows at 1 and 2 only mirrors as all-null and the two agree
 * by construction. Pure so both branches are tests, not hopes. */
export interface ParentMirror extends ConnectionFour {
  endpointVerified: boolean;
}

export function parentMirror(rows: readonly (EndpointInput & { endpointVerified?: boolean })[]): ParentMirror {
  const zero = rows.find((r) => r.position === 0);
  if (zero === undefined) {
    return { protocol: null, endpointHost: null, endpointPort: null, compid: null, endpointVerified: false };
  }
  return {
    protocol: zero.protocol,
    endpointHost: zero.endpointHost,
    endpointPort: zero.endpointPort,
    compid: zero.compid,
    endpointVerified: zero.endpointVerified ?? false,
  };
}

/** Proposal writer (section 1 row 3). Inserts the round's rows, then mirrors position 0 onto
 * the proposal row's four parent columns. The mirror is an UPDATE of a row the caller inserted
 * in this same transaction and has not committed, so the 0061 "append-only, never updated in
 * place" rule holds for every committed row; it is an UPDATE and not part of the INSERT because
 * the INSERT lives in provider-tier-proposals.ts, which may not name the four columns (grep gate
 * (b), :278-281). Caller holds the transaction. */
export async function insertProposalEndpoints(
  client: Queryable,
  proposalId: string,
  rows: readonly EndpointInput[]
): Promise<void> {
  for (const r of rows) {
    await client.query(
      `insert into provider_tier_proposal_endpoints
         (proposal_id, position, protocol, endpoint_host, endpoint_port, compid, notes)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [proposalId, r.position, r.protocol, r.endpointHost, r.endpointPort, r.compid, r.notes]
    );
  }
  const m = parentMirror(rows);
  await client.query(
    `update provider_tier_proposals
        set protocol = $2, endpoint_host = $3, endpoint_port = $4, compid = $5
      where id = $1`,
    [proposalId, m.protocol, m.endpointHost, m.endpointPort, m.compid]
  );
}

/** Tier writer, the set as given: delete every row of the tier, insert `rows` with their
 * verified flags as passed, mirror position 0 (four + endpoint_verified) onto provider_tiers.
 * Used by replaceTierEndpoints (confirm, flags from the carry) and by registerProviderTiers
 * (row 8: position 0 only, flag from the checkbox, design 2.2 :178-179). Caller holds the
 * transaction AND the provider_tiers row lock: `select ... for update`, or the row was
 * inserted in this same transaction and no other transaction can see it yet. */
export async function writeTierEndpoints(
  client: Queryable,
  tierId: string,
  rows: readonly LiveEndpoint[]
): Promise<void> {
  await client.query(`delete from provider_tier_endpoints where tier_id = $1`, [tierId]);
  for (const r of rows) {
    await client.query(
      `insert into provider_tier_endpoints
         (tier_id, position, protocol, endpoint_host, endpoint_port, compid, notes, endpoint_verified)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tierId, r.position, r.protocol, r.endpointHost, r.endpointPort, r.compid, r.notes, r.endpointVerified]
    );
  }
  const m = parentMirror(rows);
  await client.query(
    `update provider_tiers
        set protocol = $2, endpoint_host = $3, endpoint_port = $4, compid = $5, endpoint_verified = $6
      where id = $1`,
    [tierId, m.protocol, m.endpointHost, m.endpointPort, m.compid, m.endpointVerified]
  );
}

/** Confirm's replace-set (design 2.2 [N3], :154-158): snapshot the tier's live rows, compute
 * the carry from that pre-delete snapshot by the four-tuple, then delete-and-insert through
 * writeTierEndpoints. Never upsert-by-position. Returns the rows as written, flags included, so
 * the caller can say which rows carried. The snapshot is `for update` as well: the caller
 * already holds the provider_tiers row lock (confirm, J3), and locking the child rows too
 * costs nothing and refuses a second replace on the same tier that did not take the parent
 * lock. Caller holds the transaction. */
export async function replaceTierEndpoints(
  client: Queryable,
  tierId: string,
  rows: readonly EndpointInput[]
): Promise<LiveEndpoint[]> {
  const snapshot = await client.query<ChildRow>(
    `select tier_id as parent_id, position, protocol, endpoint_host, endpoint_port, compid, notes, endpoint_verified
       from provider_tier_endpoints
      where tier_id = $1
      order by position
        for update`,
    [tierId]
  );
  const after = carryVerification(snapshot.rows.map(mapLive), rows);
  await writeTierEndpoints(client, tierId, after);
  return after;
}
