-- Consult S3: service-provider profiles + service types (foc16; marcus m71309 order S2 -> S3, m71305 any service
-- provider, m71301 profiles shown in the marketplace, m71335 item 4 service types on the application). ADDITIVE ONLY:
-- one new table, and two new columns on consultant_applications that default so every existing row stays valid.
-- No price column anywhere (prices only in Telegram, coxwell). No public email or phone: a client reaches a provider
-- through a request (S4, consult_requests), never through contact details on the profile (marcus m71309).
--
-- Service types: ONE vocabulary for the application and the profile, the literal list in src/lib/consult-service-types.ts
-- (consult-s3-0116.test.ts pins this CHECK to it, the consult-slug.ts pattern). 'other' carries a free-text name, and
-- only 'other' does: a row has service_other exactly when 'other' is ticked.
--
-- consultant_applications (0112) gains:
--   service_types text[] NOT NULL DEFAULT '{}': rows from before 0116 keep '{}' and show as "not stated"; the form
--     requires at least one from 0116 on (the action enforces that; the DB cannot, without breaking the old rows).
--   service_other text: 1..200, present exactly when 'other' is in service_types.
--
-- consultant_profiles: the public face of ONE approved application, owned by the account that application is linked to.
--   user_id unique: one profile per account. application_id unique: one profile per application. The lib writes a
--     profile only for the account's own APPROVED, LINKED application (resolveConsultantAccount); the marketplace shows
--     it only while that application is still approved AND published AND NOT admin_hidden (S4 reads the same gate).
--   slug: the public URL segment, the consult-slug.ts shape (lowercase a-z0-9, single hyphens, <= 64), unique.
--   display_name 1..80, headline 1..120, about 1..2000, markets/platforms/languages free text 0..200 each.
--   service_types: at least one, from the vocabulary; service_other as on the application.
--   published: the provider's own switch, default off. admin_hidden: admins can take a profile down, default off.
--   No price, no email, no phone, no telegram column.
--
-- consult_requests (0105) gains provider_profile_id, and its service CHECK widens to allow it (see the end of this file).
--
-- Constraints are named so a later widening can drop them by name. APPLY BEFORE the code that writes these merges.
-- Rollback: 0116_rollback.sql (refuses while any provider request, any profile or any stated service type exists).
alter table consultant_applications
  add column if not exists service_types text[] not null default '{}'
    constraint consultant_applications_service_types_check
    check (service_types <@ array['consulting', 'coding', 'setup', 'other']::text[]),
  add column if not exists service_other text
    constraint consultant_applications_service_other_check
    check (service_other is null or length(service_other) between 1 and 200);
alter table consultant_applications
  add constraint consultant_applications_service_other_iff_other
    check (('other' = any(service_types)) = (service_other is not null));

create table if not exists consultant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade
    constraint consultant_profiles_user_uniq unique,
  application_id uuid not null references consultant_applications(id) on delete restrict
    constraint consultant_profiles_application_uniq unique,
  slug text not null
    constraint consultant_profiles_slug_uniq unique
    constraint consultant_profiles_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  display_name text not null
    constraint consultant_profiles_display_name_check check (length(display_name) between 1 and 80),
  headline text not null
    constraint consultant_profiles_headline_check check (length(headline) between 1 and 120),
  about text not null
    constraint consultant_profiles_about_check check (length(about) between 1 and 2000),
  service_types text[] not null
    constraint consultant_profiles_service_types_check
    check (cardinality(service_types) >= 1 and service_types <@ array['consulting', 'coding', 'setup', 'other']::text[]),
  service_other text
    constraint consultant_profiles_service_other_check check (service_other is null or length(service_other) between 1 and 200),
  markets text not null default ''
    constraint consultant_profiles_markets_check check (length(markets) <= 200),
  platforms text not null default ''
    constraint consultant_profiles_platforms_check check (length(platforms) <= 200),
  languages text not null default ''
    constraint consultant_profiles_languages_check check (length(languages) <= 200),
  published boolean not null default false,
  admin_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consultant_profiles_service_other_iff_other check (('other' = any(service_types)) = (service_other is not null))
);

create index if not exists consultant_profiles_listed_idx
  on consultant_profiles (updated_at desc)
  where published and not admin_hidden;

-- A client's request to ONE provider (S4; marcus m71393, folded into 0116 so one migration means one review and one
-- prod apply). consult_requests (0105) gains provider_profile_id: the profile the request is addressed to, set at
-- create. NOT routed_to_user_id, which means "accepted by" (0105). ON DELETE RESTRICT: a profile with requests cannot be
-- deleted from under them. The 0105 CHECK "a row without a package is a question" widens to also allow a row that names
-- a provider; dropped and re-added under its own name, so 0116_rollback restores 0105's exact text. One OPEN request
-- (pending or accepted) per client per provider; declined / answered / closed free it.
alter table consult_requests
  add column if not exists provider_profile_id uuid references consultant_profiles(id) on delete restrict;
alter table consult_requests drop constraint if exists consult_requests_service_check;
alter table consult_requests
  add constraint consult_requests_service_check
    check (service_id is not null or kind = 'question' or provider_profile_id is not null);
create unique index if not exists consult_requests_one_open_provider_uidx
  on consult_requests (user_id, provider_profile_id)
  where provider_profile_id is not null and status in ('pending', 'accepted');

insert into schema_migrations (version, name) values
  ('0116', '0116_consultant_profiles.sql')
on conflict (version) do nothing;
