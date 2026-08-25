-- Reference ID mismatch (marcus, feed-admin-provider-applications-rebuild-2026-08-25): the
-- FP-YYYY-NNNN shown to an applicant at submit time (provider-apply-form.tsx) was generated
-- client-side and never persisted; the admin queue independently derived a *different*
-- FP-YYYY-NNNN by hashing the row id. Same submission, two different "reference" strings.
-- Fix: persist one server-generated reference at insert time, show that same value to the
-- applicant and the admin queue.
--
-- Backfill assigns existing rows a sequential per-year reference. This does NOT necessarily
-- match whatever random value a past applicant's browser showed them at submit (that value was
-- never captured anywhere), so pre-existing rows may not resolve by an applicant's old "FP-..."
-- follow-up email -- unavoidable, the original value was never stored. From this migration
-- forward, the value shown and the value stored are the same string.
alter table provider_applications add column reference_id text;

with numbered as (
  select id, applied_at,
         row_number() over (partition by extract(year from applied_at) order by applied_at) as rn
  from provider_applications
)
update provider_applications pa
set reference_id = 'FP-' || extract(year from n.applied_at) || '-' || lpad((1000 + n.rn)::text, 4, '0')
from numbered n
where pa.id = n.id;

alter table provider_applications alter column reference_id set not null;
alter table provider_applications add constraint provider_applications_reference_id_unique unique (reference_id);

insert into schema_migrations (version, name) values
  ('0067', '0067_provider_application_reference_id.sql')
on conflict (version) do nothing;
