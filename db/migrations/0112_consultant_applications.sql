-- Consult supply side S1a: consultant applications (marcus re-issue m68993, rulings m69004, answers m69029; scope
-- kai m69020, Fable PASS WITH STRIKES m69076 S1-S5). Additive only: one new table, no ALTER on any existing table.
-- Table name from spec p3 G. No consultant_profiles (S3) and no user_roles change: an approved row is the
-- permission, there is no consultant role (ruling 3).
--
-- consultant_applications: one public application from consult.horizonhft.com (or portal /consult/apply). No
-- sign-in to apply, like 0055 partner_applications.
--   user_id: NULL at create, always. It is linked at APPROVE by an exact match on the stored email, and an
--     approve that finds more than one account refuses (Fable m69076 ask 3). It is never filled later (Fable N1,
--     open for S3).
--   email: stored lower(trim()) by the action; the CHECK holds the DB to it (Fable S1).
--   profile_url: http(s) only, in the action and here (Fable S2). The admin page links it only if it passes.
--   declined_note: private to admins, required to decline (p3 D2.2), never in the applicant's email (Fable S3).
--   One open application per email: the partial unique index covers pending AND approved, so a second
--   application after approval is refused and "the approved row for this email" is one row; a declined applicant
--   may apply again (Fable S1). It also closes the double-submit race.
--
-- Constraints are named so a later widening can drop them by name. APPLY BEFORE the code that writes this table
-- merges. Rollback: 0112_rollback.sql.
create table if not exists consultant_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  name text not null
    constraint consultant_applications_name_check check (length(name) between 1 and 120),
  email text not null
    constraint consultant_applications_email_check
    check (email = lower(btrim(email)) and length(email) between 3 and 254 and position('@' in email) > 1),
  telegram text
    constraint consultant_applications_telegram_check check (telegram is null or length(telegram) between 2 and 64),
  expertise text not null
    constraint consultant_applications_expertise_check check (length(expertise) between 1 and 1000),
  background text
    constraint consultant_applications_background_check check (background is null or length(background) <= 2000),
  profile_url text
    constraint consultant_applications_profile_url_check
    check (profile_url is null or (profile_url ~* '^https?://' and length(profile_url) <= 300)),
  status text not null default 'pending'
    constraint consultant_applications_status_check check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  declined_note text
    constraint consultant_applications_declined_note_check check (declined_note is null or length(declined_note) between 1 and 1000),
  created_at timestamptz not null default now(),
  -- A decided row has its time; a pending one has none. A decline carries its note.
  constraint consultant_applications_decided_check check ((status = 'pending') = (decided_at is null)),
  constraint consultant_applications_decline_note_required check (status <> 'declined' or declined_note is not null)
);

create unique index if not exists consultant_applications_email_open_uidx
  on consultant_applications (lower(email))
  where status <> 'declined';
create index if not exists consultant_applications_status_created_idx
  on consultant_applications (status, created_at desc);
create index if not exists consultant_applications_user_idx
  on consultant_applications (user_id) where user_id is not null;

insert into schema_migrations (version, name) values
  ('0112', '0112_consultant_applications.sql')
on conflict (version) do nothing;
