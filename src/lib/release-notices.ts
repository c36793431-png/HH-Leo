/** Release notice (coxwell via marcus m74711/m74713/m74741, rulings m74769 + m75122; plan v2 m74764; Fable m75121):
 * an admin tells EVERY linked channel "version X is out". Two audiences, a user is in exactly one:
 *   A = clients, full notice. B = every other user, short update.
 * This file is the audience + the dry-run counts. The send engine, renders and guards are added by later shas.
 *
 * THE SQL IS THE AUDIENCE (marcus m74769 Q7, Fable C8):
 *  - A = the paid predicate, the WHERE of isPaidUser (licenses.ts: status 'active' AND expires_at > now()), minus the
 *    internal/test accounts. Expired-only and revoked-only clients are B: the A text tells them to download from their
 *    dashboard, which isPaidUser refuses them. release-notices-0117.test.ts pins this fragment to isPaidUser's SQL and
 *    asserts isPaidUser(user) === (user is in A) for every user, so the two cannot drift apart.
 *  - B = everyone else, minus the internal/test accounts, minus anyone who unsubscribed (users.release_updates_opt_out_at,
 *    which gates both B channels). A ignores the opt-out: it is a service notice to licence holders.
 *  - notAClientSql is imported, never copied (it is the one rule for "internal/test", licenses.ts).
 * The audience is computed here ONCE per dry run and FROZEN into release_notice_runs.recipients (Fable S3); destinations
 * and the channel set are re-read at claim time by the send engine. */
import { pool, type Db } from "./db";
import { notAClientSql } from "./licenses";
import { reachability } from "./client-reach";

export type Audience = "A" | "B";
export type ReachBucket = "tg_only" | "email_only" | "both" | "unreachable";
export type NoticeChannel = "telegram" | "email";

/** "Has a paid licence": the WHERE of isPaidUser as an EXISTS, so a user with several licence rows is one row. */
export function paidLicenceSql(alias: string): string {
  return `exists (select 1 from licenses pl where pl.user_id = ${alias}.id and pl.status = 'active' and pl.expires_at > now())`;
}

export function audienceASql(alias: string): string {
  return `(${paidLicenceSql(alias)} and not ${notAClientSql(alias)})`;
}

export function audienceBSql(alias: string): string {
  return `(not ${paidLicenceSql(alias)} and not ${notAClientSql(alias)} and ${alias}.release_updates_opt_out_at is null)`;
}

export interface AudienceRow {
  userId: string;
  audience: Audience;
  email: string | null;
  telegramUserId: string | null;
  botStartedAt: Date | null;
  tgLastDmAt: Date | null;
  tgLastDmOk: boolean | null;
  tgLastDmError: string | null;
  isAdmin: boolean;
  /** Any licence row that is not revoked (expired included): a B user with this is an "expired client" (Q7). */
  hasNonRevokedLicence: boolean;
}

/** Everyone who gets a notice, in a total order (created_at, id), each user exactly once with their audience. */
export async function loadAudience(db: Db = pool): Promise<AudienceRow[]> {
  const r = await db.query(
    `select u.id, nullif(btrim(u.email), '') as email, u.telegram_user_id::text as telegram_user_id,
            u.telegram_bot_started_at, u.tg_last_dm_at, u.tg_last_dm_ok, u.tg_last_dm_error, u.role,
            case when ${audienceASql("u")} then 'A' else 'B' end as audience,
            exists (select 1 from licenses nl where nl.user_id = u.id and nl.status <> 'revoked') as has_non_revoked_licence
       from users u
      where ${audienceASql("u")} or ${audienceBSql("u")}
      order by u.created_at, u.id`
  );
  return r.rows.map((u: Record<string, unknown>) => ({
    userId: u.id as string,
    audience: u.audience as Audience,
    email: (u.email as string | null) ?? null,
    telegramUserId: (u.telegram_user_id as string | null) ?? null,
    botStartedAt: (u.telegram_bot_started_at as Date | null) ?? null,
    tgLastDmAt: (u.tg_last_dm_at as Date | null) ?? null,
    tgLastDmOk: (u.tg_last_dm_ok as boolean | null) ?? null,
    tgLastDmError: (u.tg_last_dm_error as string | null) ?? null,
    isAdmin: u.role === "admin",
    hasNonRevokedLicence: Boolean(u.has_non_revoked_licence),
  }));
}

/** The dry-run bucket (plan v1/v2): both = TG linked AND an email (two independent sends, not a fallback);
 * unreachable = no email AND Telegram is not linked, or is linked but blocked / never started (reachability()).
 * The real send still TRIES Telegram for every linked user (marcus Q2): a miss costs one 403, and a "blocked" user
 * who turns out delivered drops off the alert list. */
export function classify(row: AudienceRow): ReachBucket {
  const hasTg = row.telegramUserId != null;
  const hasEmail = row.email != null;
  if (hasTg && hasEmail) return "both";
  if (hasEmail) return "email_only";
  const reach = reachability({
    email: row.email,
    telegramUserId: row.telegramUserId,
    botStartedAt: row.botStartedAt,
    tgLastDmAt: row.tgLastDmAt,
    tgLastDmOk: row.tgLastDmOk,
    tgLastDmError: row.tgLastDmError,
  });
  return hasTg && reach.reachable ? "tg_only" : "unreachable";
}

/** The channels the send will try for this row now: every linked one (Q2). */
export function channelsFor(row: AudienceRow): NoticeChannel[] {
  const out: NoticeChannel[] = [];
  if (row.telegramUserId != null) out.push("telegram");
  if (row.email != null) out.push("email");
  return out;
}

/** One entry of release_notice_runs.recipients: WHO and which text (audience), not WHERE (Fable S3). */
export interface FrozenRecipient {
  user_id: string;
  audience: Audience;
  bucket: ReachBucket;
  channels: NoticeChannel[];
}

export type BucketCounts = Record<ReachBucket, number> & { total: number };

export interface DryRunCounts {
  A: BucketCounts;
  B: BucketCounts;
  /** Users the rule leaves out because they are internal/test accounts (notAClientSql), in neither audience (C6). */
  excluded_internal_test: number;
  /** Licences with no account yet that are active and unexpired: not sent to, listed on the run page (Q1, C6). */
  unclaimed_licences: number;
  /** Not internal/test, not paid, and unsubscribed: left out of B. */
  b_opted_out: number;
  /** B users who hold a licence row that is not revoked (so: expired clients). Information only, already inside B (Q7). */
  expired_clients_in_b: number;
  /** Admins are in B unless they hold a paid licence; the run page says so (C7). */
  admins_in_b: number;
}

const zero = (): BucketCounts => ({ tg_only: 0, email_only: 0, both: 0, unreachable: 0, total: 0 });

export function summarise(rows: AudienceRow[]): Pick<DryRunCounts, "A" | "B" | "expired_clients_in_b" | "admins_in_b"> {
  const A = zero();
  const B = zero();
  let expired = 0;
  let admins = 0;
  for (const row of rows) {
    const c = row.audience === "A" ? A : B;
    c[classify(row)]++;
    c.total++;
    if (row.audience === "B") {
      if (row.hasNonRevokedLicence) expired++;
      if (row.isAdmin) admins++;
    }
  }
  return { A, B, expired_clients_in_b: expired, admins_in_b: admins };
}

export interface UnclaimedLicence {
  id: string;
  claimEmail: string | null;
  claimTelegramUserId: string | null;
  expiresAt: Date;
}

/** Active, unexpired licences nobody has claimed yet (user_id null). No licence key: the run page shows who, not what. */
export async function listUnclaimedLicences(db: Db = pool): Promise<UnclaimedLicence[]> {
  const r = await db.query(
    `select id, claim_email, claim_telegram_user_id::text as claim_telegram_user_id, expires_at
       from licenses
      where user_id is null and status = 'active' and expires_at > now()
      order by expires_at, id`
  );
  return r.rows.map((l: Record<string, unknown>) => ({
    id: l.id as string,
    claimEmail: (l.claim_email as string | null) ?? null,
    claimTelegramUserId: (l.claim_telegram_user_id as string | null) ?? null,
    expiresAt: l.expires_at as Date,
  }));
}

export interface DryRunAudience {
  recipients: FrozenRecipient[];
  counts: DryRunCounts;
  unclaimed: UnclaimedLicence[];
}

/** Read-only: the frozen recipient list and every count the dry run shows. Writes nothing. */
export async function dryRunAudience(db: Db = pool): Promise<DryRunAudience> {
  const rows = await loadAudience(db);
  const unclaimed = await listUnclaimedLicences(db);
  const excluded = await db.query(`select count(*)::int as n from users u where ${notAClientSql("u")}`);
  const optedOut = await db.query(
    `select count(*)::int as n from users u
      where not ${paidLicenceSql("u")} and not ${notAClientSql("u")} and u.release_updates_opt_out_at is not null`
  );
  const s = summarise(rows);
  return {
    recipients: rows.map((row) => ({ user_id: row.userId, audience: row.audience, bucket: classify(row), channels: channelsFor(row) })),
    counts: {
      A: s.A,
      B: s.B,
      excluded_internal_test: excluded.rows[0].n,
      unclaimed_licences: unclaimed.length,
      b_opted_out: optedOut.rows[0].n,
      expired_clients_in_b: s.expired_clients_in_b,
      admins_in_b: s.admins_in_b,
    },
    unclaimed,
  };
}
