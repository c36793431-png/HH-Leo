-- Consulting, two-sided (plan m65563-5, ruled m65571; Fable PASS WITH STRIKES m65602; build GO
-- marcus m66250). Additive only: two new tables, no ALTER on any existing table. Independent of
-- 0103 (consultant applications, not written yet): this depends on users only.
--
-- consult_services: Horizon house packages (owner_user_id NULL, kind 'human_expert') and, later,
-- consultant-proposed services (owner set, kind 'consultant'). No 'ai_agent' kind: AI packages are
-- Horizon AI marketplace listings in code, and only on coxwell's word (marcus Nova ruling Q6,
-- m66242). One table, no proposals table: a service has no live terms to keep while new ones are
-- reviewed. v1 edits to a live service are admin-only, or retire + re-propose.
--   slug: the public URL segment /marketplace/consulting/<slug>. The CHECK is literally
--     CONSULT_SLUG_PATTERN / CONSULT_SLUG_MAX / CONSULT_SLUG_RESERVED in src/lib/consult-slug.ts, the
--     constant the login-callback twin uses; consult-0105.test.ts pins the two together. 'ask' and
--     'apply' are static pages. A retired service keeps its slug and its page.
--   price_cents: NULL, nothing renders it (no prices on the portal, coxwell 09-16). A known dead
--     field: its only v1 writer is the admin.
--   consultant_split_pct: NULL until coxwell rules the split and the referral stacking cap
--     (referrals.ts:104-108 pattern) - both before the first paid request.
--   declined_note: private to admins.
--   Open names are unique per owner, case-insensitive, with NULLS NOT DISTINCT so two house
--   packages (owner NULL) can't share one either (Fable S3). It also closes the double-submit race
--   submitProposalRound has on provider tiers.
--
-- consult_requests: a client's request, interest (coming-soon package) or question.
--   service_id NULL only for a question (a general question names no package).
--   telegram_handle: 0093's rule - asked only when the account has no Telegram on file; never
--     written back to users. The client's email is never stored here (Fable S1(ii)).
--   routed_to_user_id: the service owner, snapshotted at accept.
--   One pending request/interest per client per package (partial unique index).
--
-- Seed: the one house package www lists that is not Horizon AI ("Human expert", www /consulting
-- read 2026-10-13; name, summary and description are www's own words). Ask / Guided / Always-on / Custom are Horizon AI packages there, so none is a
-- row here (Q6); the Ask form is a kind='question' request with no package.
--
-- Constraints are named so a later widening can drop them by name. APPLY BEFORE the code that
-- reads these tables merges (S5). Rollback: 0105_rollback.sql.
create table if not exists consult_services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    constraint consult_services_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64 and slug not in ('ask', 'apply')),
  kind text not null
    constraint consult_services_kind_check check (kind in ('human_expert', 'consultant')),
  owner_user_id uuid references users(id) on delete restrict,
  name text not null
    constraint consult_services_name_check check (length(name) between 1 and 120),
  summary text not null
    constraint consult_services_summary_check check (length(summary) between 1 and 280),
  description text
    constraint consult_services_description_check check (description is null or length(description) <= 4000),
  delivery text
    constraint consult_services_delivery_check check (delivery is null or length(delivery) <= 500),
  price_cents integer
    constraint consult_services_price_check check (price_cents is null or price_cents >= 0),
  consultant_split_pct integer
    constraint consult_services_split_check check (consultant_split_pct is null or consultant_split_pct between 0 and 100),
  availability text not null default 'available'
    constraint consult_services_availability_check check (availability in ('available', 'coming-soon')),
  status text not null default 'proposed'
    constraint consult_services_status_check check (status in ('proposed', 'live', 'declined', 'retired')),
  declined_note text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A house package has no owner; a consultant's service always has one.
  constraint consult_services_owner_kind_check check ((owner_user_id is null) = (kind = 'human_expert'))
);

create unique index if not exists consult_services_owner_name_open_uidx
  on consult_services (owner_user_id, lower(name)) nulls not distinct
  where status in ('proposed', 'live');
create index if not exists consult_services_status_sort_idx
  on consult_services (status, sort_order);

create table if not exists consult_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  service_id uuid references consult_services(id) on delete restrict,
  kind text not null
    constraint consult_requests_kind_check check (kind in ('request', 'interest', 'question')),
  body text
    constraint consult_requests_body_check check (body is null or length(body) <= 2000),
  telegram_handle text
    constraint consult_requests_telegram_handle_check check (telegram_handle is null or length(telegram_handle) between 2 and 64),
  status text not null default 'pending'
    constraint consult_requests_status_check check (status in ('pending', 'accepted', 'declined', 'answered', 'closed')),
  routed_to_user_id uuid references users(id) on delete set null,
  answer text
    constraint consult_requests_answer_check check (answer is null or length(answer) <= 4000),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint consult_requests_service_check check (service_id is not null or kind = 'question')
);

create unique index if not exists consult_requests_one_pending_uidx
  on consult_requests (user_id, service_id, kind)
  where status = 'pending' and kind <> 'question';
create index if not exists consult_requests_status_created_idx
  on consult_requests (status, created_at desc);
create index if not exists consult_requests_user_idx
  on consult_requests (user_id, created_at desc);
create index if not exists consult_requests_routed_idx
  on consult_requests (routed_to_user_id, created_at desc) where routed_to_user_id is not null;

insert into consult_services (slug, kind, name, summary, description, availability, status, sort_order) values
  ('human-expert', 'human_expert', 'Human expert',
   'Takes over with the full case.',
   'When it needs a person, a human expert sees the whole case.',
   'available', 'live', 10)
on conflict (slug) do nothing;

insert into schema_migrations (version, name) values
  ('0105', '0105_consult_services_requests.sql')
on conflict (version) do nothing;
