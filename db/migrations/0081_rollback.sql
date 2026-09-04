-- Companion to 0081_feed_subscriptions_license_id.sql. NOT applied automatically by that
-- migration and NOT run as part of building/reviewing it -- written out ahead of execution
-- per marcus's explicit ask (m36648/m36651, thread leo-london-backfill-2026-09-04), so it
-- exists before the transaction runs, not composed after something goes wrong.
--
-- Reverses 0081 in the opposite order: index swap back, drop the 21 explicit-id rows (the
-- ones this migration inserted, by id -- not a status or date filter, so it can't touch
-- anything else), then the column itself. Does NOT attempt to un-backfill license_id on the
-- 8 pre-existing rows individually -- dropping the column removes that data for all rows at
-- once, which is correct since 0081 is what introduced the column in the first place.
--
-- If 0081 already failed mid-transaction (any of its DO-block preflights raised, or any
-- statement errored), Postgres has already rolled it back automatically and none of this is
-- needed -- this script is only for reversing a migration that fully COMMITted and is later
-- decided to be wrong.

begin;

drop index if exists feed_subscriptions_license_feed_tier_live_uidx;

create unique index if not exists feed_subscriptions_subscriber_feed_tier_live_uidx
  on feed_subscriptions (subscriber_user_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

delete from feed_subscriptions
where id in (
  '6b289973-d884-496a-af5c-409948e7ff34',
  '66ff6d2a-0898-4fab-8b0f-b79cacb5b4bc',
  '26d6e55e-445c-4d1d-87cb-cf73685744e7',
  'ac5f6031-d51f-4f3d-b46c-10df3f133fd0',
  '2230a0d5-909e-47fd-b721-161de60bc678',
  '75efdca4-48e4-4612-948b-ddb6d14d1726',
  '6ee69a58-fb85-4572-901a-3d2ab5ad8586',
  '224c74f0-7cec-4338-874d-9fb219c20c70',
  '610fb605-ad42-4f69-b9ad-18cc9d499ee2',
  '4a0a7fb8-0ac2-49f4-b7a8-4007a7c92500',
  '82147257-d90b-4ed9-a12e-68adeaf0b2d4',
  '00f9e32c-70e8-46f6-a74c-43317edf62c5',
  'a909d7b1-e9ed-47ab-81f9-b84f55345b93',
  'e4072a70-ebcb-4121-9f38-7bd24bc5930c',
  '43b24734-e77f-40be-afe0-a2a630d4182d',
  'b45e07dc-1149-4e0d-9ccd-f82cc6fc8bb3',
  '960b5641-c036-4f79-ada0-020f9eb7e5ac',
  '0b358beb-d4cd-4034-a805-7a23f68090d5',
  '2e7ad400-9c26-440c-af09-44db1aa8d254',
  'a453d4c0-fcb0-4643-a244-ad6e14273164',
  '1161625a-72bb-4472-9282-16062f0cad13'
);

alter table feed_subscriptions
  alter column license_id drop not null;

alter table feed_subscriptions
  drop column if exists license_id;

delete from schema_migrations where version = '0081';

commit;
