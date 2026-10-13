-- Axiom signals dashboard, slice S1 (marcus m67349; plan docs/specs/axiom-signals-dashboard-plan.md section 3 at
-- S1, fable PASS WITH CHANGES m67474 of S0.2 7eb9a73 with schema deltas D1-D3; number 0110 marcus m67403).
-- One row per signal call: a source (Axiom now, others later) registers a call for a window and scores it later.
-- received_at / entry_px_at / scored_at are the portal's own clock and are the timing evidence the page shows.
--
-- direction: Axiom's words up / down / neutral (marcus R1 m67429). A neutral call is a registration that is never
--   scored (fable N1 m67474): no prices, no bar stamps, no outcome (signal_calls_neutral_unscored).
-- entry_px_at: portal clock when entry_px first fills (fable D1 m67474), never sent by the source.
-- entry_bar_ts / exit_bar_ts: START of the hourly bar the price came from, as sent (fable Q9 m67474: 06:00Z, or the
--   07/08 fallback, for entry; 20:00Z, or the 19/18 fallback, for exit).
-- move: signed, in the symbol's unit (src/lib/signal-instruments.ts, S2a), + = in the call's favour.
-- The stamp CHECKs are conjoined equalities: `a = b = c` is a syntax error in Postgres (0107:9).
-- Trigger: three column families (fable P2 m67410, G1/G2 m67417, D2/D3 m67474); a correction SQL file bypasses all
--   three with `set local signal_calls.allow_correction = 'on'` inside its transaction. DELETE is not blocked.
--
-- Additive only, one new table. APPLY BEFORE THE CODE REACHES MAIN: the ingest route (S2) and the page (S4) both
-- name signal_calls. Rollback: 0110_rollback.sql.
begin;

create table if not exists signal_calls (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z][a-z0-9-]{1,31}$'),
  symbol text not null check (symbol ~ '^[A-Z0-9]{3,12}$'),
  session_date date not null,
  direction text not null check (direction in ('up', 'down', 'neutral')),
  entry_ts timestamptz not null,
  exit_ts timestamptz not null,
  entry_px numeric,
  entry_px_at timestamptz,
  entry_bar_ts timestamptz,
  exit_px numeric,
  exit_bar_ts timestamptz,
  move numeric,
  outcome text check (outcome in ('right', 'wrong', 'flat')),
  meta jsonb,
  received_at timestamptz not null default now(),
  scored_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint signal_calls_window check (exit_ts > entry_ts),
  constraint signal_calls_entry_stamp check (
    ((entry_px is null) = (entry_px_at is null)) and ((entry_px is null) = (entry_bar_ts is null))
  ),
  constraint signal_calls_scored_stamp check (
    ((outcome is null) = (exit_px is null)) and ((outcome is null) = (move is null))
    and ((outcome is null) = (scored_at is null)) and ((outcome is null) = (exit_bar_ts is null))
    and (outcome is null or entry_px is not null)
  ),
  constraint signal_calls_neutral_unscored check (
    direction <> 'neutral' or (entry_px is null and exit_px is null and outcome is null)
  ),
  constraint signal_calls_one_per_window unique (source, symbol, entry_ts)
);
create index if not exists signal_calls_source_date_idx on signal_calls(source, session_date);

create or replace function signal_calls_guard_update() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('signal_calls.allow_correction', true), '') = 'on' then
    return new;
  end if;
  -- NEVER: never changes.
  if new.source is distinct from old.source then raise exception 'signal_calls: source never changes'; end if;
  if new.symbol is distinct from old.symbol then raise exception 'signal_calls: symbol never changes'; end if;
  if new.entry_ts is distinct from old.entry_ts then raise exception 'signal_calls: entry_ts never changes'; end if;
  if new.exit_ts is distinct from old.exit_ts then raise exception 'signal_calls: exit_ts never changes'; end if;
  if new.session_date is distinct from old.session_date then raise exception 'signal_calls: session_date never changes'; end if;
  if new.direction is distinct from old.direction then raise exception 'signal_calls: direction never changes'; end if;
  if new.received_at is distinct from old.received_at then raise exception 'signal_calls: received_at never changes'; end if;
  -- FILL-ONLY: null -> value only; once set it never changes, scored or not.
  if old.entry_px is not null and new.entry_px is distinct from old.entry_px then
    raise exception 'signal_calls: entry_px is fill-only';
  end if;
  if old.entry_px_at is not null and new.entry_px_at is distinct from old.entry_px_at then
    raise exception 'signal_calls: entry_px_at is fill-only';
  end if;
  if old.entry_bar_ts is not null and new.entry_bar_ts is distinct from old.entry_bar_ts then
    raise exception 'signal_calls: entry_bar_ts is fill-only';
  end if;
  if old.meta is not null and new.meta is distinct from old.meta then
    raise exception 'signal_calls: meta is fill-only';
  end if;
  -- FROZEN-ONCE-SCORED: nothing in the scored form changes once old.outcome is set.
  if old.outcome is not null and (
    new.exit_px is distinct from old.exit_px or new.exit_bar_ts is distinct from old.exit_bar_ts
    or new.move is distinct from old.move or new.outcome is distinct from old.outcome
    or new.scored_at is distinct from old.scored_at
  ) then
    raise exception 'signal_calls: the scored form is frozen once scored';
  end if;
  return new;
end $$;

drop trigger if exists signal_calls_guard on signal_calls;
create trigger signal_calls_guard before update on signal_calls
  for each row execute function signal_calls_guard_update();

insert into schema_migrations (version, name) values
  ('0110', '0110_signal_calls.sql')
on conflict (version) do nothing;

commit;
