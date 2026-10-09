/** Client reach (coxwell 10-06 via marcus m61849, design m61875/m61876): a client who is granted something is
 * always told, or the admin is told that we couldn't; requests don't sit unanswered; new users are welcomed.
 * No server address, port, login or password in any message or notice: connection details stay behind login. */
import { pool } from "./db";
import { notifyUser, type NotifyAttempt, type NotifyOutcome } from "./notify";
import { notifyClientUnreachable, notifyStaleBasketRequest } from "./telemetry-sink";
import { clientRefForUser } from "./client-ref";

const PORTAL = "https://portal.horizonhft.com";
export const SERVERS_URL = `${PORTAL}/account/servers`;
export const FEEDER_GUIDE_URL = "https://horizonhft.com/education/connect-the-feeder";
export const SUPPORT_HANDLE = "@Coxwell2";

export interface ClientContact {
  userId: string;
  name: string | null;
  email: string | null;
  telegramUsername: string | null;
  telegramUserId: string | null;
  botStartedAt: Date | null;
  tgLastDmAt: Date | null;
  tgLastDmOk: boolean | null;
  tgLastDmError: string | null;
  onboardingGoal: OnboardingGoal | null;
}

export async function getClientContact(userId: string): Promise<ClientContact | null> {
  const r = await pool.query(
    `select id, display_name, email, telegram_username, telegram_user_id, telegram_bot_started_at,
            tg_last_dm_at, tg_last_dm_ok, tg_last_dm_error, onboarding_goal
       from users where id = $1`,
    [userId]
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    userId: u.id,
    name: u.display_name ?? null,
    email: u.email ?? null,
    telegramUsername: u.telegram_username ?? null,
    telegramUserId: u.telegram_user_id != null ? String(u.telegram_user_id) : null,
    botStartedAt: u.telegram_bot_started_at ?? null,
    tgLastDmAt: u.tg_last_dm_at ?? null,
    tgLastDmOk: u.tg_last_dm_ok ?? null,
    tgLastDmError: u.tg_last_dm_error ?? null,
    onboardingGoal: u.onboarding_goal ?? null,
  };
}

/** notifyUser for a user id: their Telegram (result recorded on the user), then email. */
export async function notifyClient(userId: string, subject: string, message: string): Promise<NotifyOutcome> {
  const c = await getClientContact(userId);
  if (!c) return { channel: "none", ok: false, unreachable: true, error: "no users row" };
  return notifyUser({ userId, telegramUserId: c.telegramUserId, email: c.email }, subject, message);
}

const why = (attempts: NotifyAttempt[] | undefined) =>
  attempts?.length ? attempts.map((a) => `${a.channel}: ${a.ok ? "ok" : a.error}`).join("; ").slice(0, 400) : "no Telegram and no email on file";

/** A grant/approval/handled event reached nobody: store it first (Vercel logs last an hour), then alert the
 * approvals topic, then stamp alert_sent_at. A failed alert leaves the row with alert_sent_at null. Never throws. */
export async function reportUnreachable(userId: string, what: string, attempts?: NotifyAttempt[]): Promise<void> {
  try {
    const row = await pool.query(
      `insert into client_unreachable_alerts (user_id, what, attempts) values ($1, $2, $3::jsonb) returning id`,
      [userId, what.slice(0, 300), JSON.stringify(attempts ?? [])]
    );
    const id = row.rows[0].id;
    const c = await getClientContact(userId);
    const client = await clientRefForUser(userId);
    const sent = await notifyClientUnreachable({ client, name: c?.name ?? null, what, why: why(attempts) }).catch(() => false);
    if (sent) await pool.query(`update client_unreachable_alerts set alert_sent_at = now() where id = $1`, [id]);
  } catch (err) {
    console.error("client-reach: reportUnreachable failed", userId, err instanceof Error ? err.message : err);
  }
}

/** The approved notice text. "what" is ours (e.g. "London trial, 30 days"), never a key or an address. */
export function approvalMessage(what: string): { subject: string; message: string } {
  return {
    subject: "Your Horizon request is approved: next step",
    message: [
      `Your request is approved: ${what}.`,
      "",
      "Next step:",
      `1. Register your server: ${SERVERS_URL}`,
      `2. Connect the feeder, step by step: ${FEEDER_GUIDE_URL}`,
      "",
      `Your connection details are in the portal after you log in; we never send them in a message. Questions: ${SUPPORT_HANDLE} on Telegram.`,
    ].join("\n"),
  };
}

/** The dashboard banner for a grant. Best-effort: a failed insert never blocks the grant. */
export async function addApprovedNotice(userId: string, what: string): Promise<void> {
  await pool
    .query(`insert into client_notices (user_id, kind, what) values ($1, 'approved', $2)`, [userId, what.slice(0, 300)])
    .catch((err) => console.error("client-reach: notice insert failed", userId, err instanceof Error ? err.message : err));
}

/** A request granted or handled: banner + message through the working channel; unreachable -> admin alert. */
export async function notifyApproved(userId: string, what: string): Promise<NotifyOutcome> {
  await addApprovedNotice(userId, what);
  const { subject, message } = approvalMessage(what);
  const out = await notifyClient(userId, subject, message);
  if (!out.ok) await reportUnreachable(userId, what, out.attempts);
  return out;
}

/** A basket request marked Handled. Handled is bookkeeping and can follow a decline, so this never says
 * "approved": it says the request is finished and points to the dashboard, where any grant shows. A client we
 * can't reach raises the admin alert, so a handled request is never left untold. */
export async function notifyRequestHandled(userId: string, reference: string): Promise<NotifyOutcome> {
  const message = [
    `Your request ${reference} is complete.`,
    `Whatever we set up for you is on your dashboard: ${PORTAL}/dashboard`,
    `If it includes a feed, the next step is to register your server (${SERVERS_URL}) and connect the feeder: ${FEEDER_GUIDE_URL}`,
    "",
    `Questions: ${SUPPORT_HANDLE} on Telegram.`,
  ].join("\n");
  const out = await notifyClient(userId, `Your Horizon request ${reference} is complete`, message);
  if (!out.ok) await reportUnreachable(userId, `request ${reference} marked handled`, out.attempts);
  return out;
}

export async function listOpenNotices(userId: string): Promise<{ id: string; kind: "approved"; what: string; createdAt: Date }[]> {
  const r = await pool.query(
    `select id, kind, what, created_at from client_notices where user_id = $1 and dismissed_at is null order by created_at desc limit 3`,
    [userId]
  );
  return r.rows.map((n: { id: string; kind: "approved"; what: string; created_at: Date }) => ({ id: n.id, kind: n.kind, what: n.what, createdAt: n.created_at }));
}

export async function dismissNotice(userId: string, noticeId: string): Promise<void> {
  await pool.query(`update client_notices set dismissed_at = now() where id = $1 and user_id = $2 and dismissed_at is null`, [noticeId, userId]);
}

/** For the client's own pages (marcus m61849 part 3, m61876): can we reach them, and should we ask them to
 * open the bot. Uses the last recorded Telegram DM when there is one, bot_started only when none was tried. */
export async function clientReachForUser(userId: string): Promise<{ reachable: boolean; hasEmail: boolean; needsBotStart: boolean }> {
  const c = await getClientContact(userId);
  if (!c) return { reachable: false, hasEmail: false, needsBotStart: true };
  const r = reachability({ email: c.email, telegramUserId: c.telegramUserId, botStartedAt: c.botStartedAt, tgLastDmAt: c.tgLastDmAt, tgLastDmOk: c.tgLastDmOk, tgLastDmError: c.tgLastDmError });
  return { reachable: r.reachable, hasEmail: Boolean(c.email), needsBotStart: !r.reachable };
}

// ---------- stale basket requests (part 5) ----------

/** One admin reminder per basket request still 'new' after 24h. reminded_at is stamped first (claim), so two
 * overlapping cron runs can't both remind. Returns how many reminders were sent. */
export async function runStaleBasketReminders(): Promise<number> {
  const claimed = await pool.query(
    `update basket_requests set reminded_at = now()
      where status = 'new' and reminded_at is null and submitted_at < now() - interval '24 hours'
      returning id, user_id, lines, submitted_at`
  );
  let sent = 0;
  for (const r of claimed.rows as { id: string; user_id: string; lines: { label?: string; name?: string; kind?: string }[]; submitted_at: Date }[]) {
    const c = await getClientContact(r.user_id);
    const lines = (Array.isArray(r.lines) ? r.lines : []).map((l) => l.label ?? l.name ?? l.kind ?? "item").join(", ").slice(0, 300);
    const ok = await notifyStaleBasketRequest({
      client: await clientRefForUser(r.user_id),
      name: c?.name ?? null,
      reference: `REQ-${r.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      submittedAt: new Date(r.submitted_at),
      lines,
    }).catch(() => false);
    if (ok) sent++;
  }
  return sent;
}

// ---------- welcome + onboarding goal (part 6) ----------

export const ONBOARDING_GOALS = {
  prop_challenge: "A prop challenge",
  own_account: "My own account",
  exploring: "Just exploring",
} as const;
export type OnboardingGoal = keyof typeof ONBOARDING_GOALS;

export function welcomeMessage(): { subject: string; message: string } {
  return {
    subject: "Welcome to Horizon",
    message: [
      "Welcome to Horizon. We're glad you're here.",
      "",
      "One question so we can help you: What are you looking to do with Horizon? (prop challenge / own account / just exploring)",
      `Answer with one tap on your dashboard: ${PORTAL}/dashboard`,
      "",
      `Questions any time: ${SUPPORT_HANDLE} on Telegram.`,
    ].join("\n"),
  };
}

/** One welcome on first login, through the working channel. Unreachable is fine here: the dashboard shows the
 * same question as a card until it's answered, so no admin alert. Never throws. */
export async function sendWelcome(userId: string, opts: { newWithinHours?: number } = {}): Promise<NotifyOutcome> {
  try {
    if (opts.newWithinHours) {
      const r = await pool.query(`select created_at > now() - make_interval(hours => $2) as fresh from users where id = $1`, [userId, opts.newWithinHours]);
      if (!r.rows[0]?.fresh) return { channel: "none", ok: false, error: "not a new account: no welcome" };
    }
    const { subject, message } = welcomeMessage();
    return await notifyClient(userId, subject, message);
  } catch (err) {
    console.error("client-reach: welcome failed", userId, err instanceof Error ? err.message : err);
    return { channel: "none", ok: false, error: "threw" };
  }
}

export async function setOnboardingGoal(userId: string, goal: OnboardingGoal): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(ONBOARDING_GOALS, goal)) throw new Error("unknown onboarding goal");
  await pool.query(`update users set onboarding_goal = $2, onboarding_goal_at = now() where id = $1`, [userId, goal]);
}

// ---------- reachability (part 7, marcus m61876): what we know about reaching a client ----------

export interface ReachFields {
  email: string | null;
  telegramUserId: string | number | null;
  botStartedAt: Date | string | null;
  tgLastDmAt: Date | string | null;
  tgLastDmOk: boolean | null;
  tgLastDmError?: string | null;
}

const mmdd = (d: Date | string) => new Date(d).toISOString().slice(5, 10);

/** Whether we can reach the client, and what that says it from: the last recorded Telegram DM when there is
 * one (delivered = reachable; 403 = blocked), bot_started only when no DM was ever tried; email counts as a
 * channel on its own. The label is shown to admins next to the contact block. */
export function reachability(r: ReachFields): { reachable: boolean; telegram: "delivered" | "blocked" | "untried" | "none"; label: string } {
  let telegram: "delivered" | "blocked" | "untried" | "none" = "none";
  let tgLabel = "Telegram: not linked";
  if (r.telegramUserId) {
    if (r.tgLastDmAt && r.tgLastDmOk === true) {
      telegram = "delivered";
      tgLabel = `Telegram: delivered ${mmdd(r.tgLastDmAt)}`;
    } else if (r.tgLastDmAt && r.tgLastDmOk === false) {
      telegram = "blocked";
      const code = /\b(4\d\d)\b/.exec(r.tgLastDmError ?? "")?.[1];
      tgLabel = `Telegram: blocked${code ? ` (${code})` : ""} ${mmdd(r.tgLastDmAt)}`;
    } else {
      telegram = "untried";
      tgLabel = r.botStartedAt ? "Telegram: never tried, bot started" : "Telegram: never tried, bot not started";
    }
  }
  const reachable = Boolean(r.email) || telegram === "delivered" || (telegram === "untried" && Boolean(r.botStartedAt));
  const label = `${tgLabel} · ${r.email ? "email on file" : "no email"}${reachable ? "" : " · can't be reached"}`;
  return { reachable, telegram, label };
}
