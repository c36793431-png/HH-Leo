-- Feed-access money in the payments ledger (marcus m64288, ruling 1; plan m64286). The admin queue's paid approve gets
-- an optional "Amount received (USD)"; when filled, the approve transaction writes ONE payments row for it, and the
-- COLLECTED tile on /admin/feed-tier-requests sums those rows. One ledger, so the tile and Finance cannot disagree.
--
-- category 'feed_access': without it feed money could only be told from licence money ('customer') by memo text.
--   Same drop-and-add shape as 0014; the dropped definition is exactly 0014's seven values (prod read 2026-10-11 00:48Z).
-- payments.access_request_id: which approval the amount came from. Nullable, so Finance's hand-entered rows are
--   unaffected; no ON DELETE action, so an envelope that has money recorded against it cannot be deleted from under it.
--
-- Additive only. APPLY BEFORE THE CODE REACHES MAIN: the approve path inserts category 'feed_access' and
-- access_request_id, and without this file that insert fails and rolls the whole approval back.
-- Rollback: 0100_rollback.sql.
begin;

alter table payments drop constraint payments_category_check;
alter table payments add constraint payments_category_check
  check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout', 'feed_access'));

alter table payments add column if not exists access_request_id uuid references access_requests(id);

create index if not exists payments_access_request_id_idx on payments(access_request_id);

insert into schema_migrations (version, name) values
  ('0100', '0100_payments_feed_access.sql')
on conflict (version) do nothing;

commit;
