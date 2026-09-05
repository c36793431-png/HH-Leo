-- Companion to 0082_provider_client_pseudonyms_backfill.sql. Not applied automatically.
-- Reverts exactly the 7 rows that migration inserts, and resets the counter to its
-- pre-migration baseline. Does not touch the 4 pre-existing pairs (seq 1, 2, 6, 12), and does
-- not touch the self-subscription pair (94529d89 -> 94529d89), which this migration never
-- allocates a pseudonym for -- see 0082's header, dropped per marcus ruling 2026-09-04.

begin;

delete from provider_client_pseudonyms
where provider_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
  and subscriber_user_id in (
    '9239faa5-88a0-4789-9774-b0c161823b29',
    'a66d928c-6830-4cb3-80af-06cfca4ad3b6',
    '5182a8be-96ab-4ad7-8b3c-ff2603e8f784',
    'a830b5f8-a358-4203-971d-281fd65784b9',
    '122221aa-789d-4830-8726-2060147d9206',
    'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db',
    '5e3fa8fd-ebac-4516-a68a-9d8101644786'
  );

update provider_pseudonym_counters
set next_seq = 13
where provider_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1';

delete from schema_migrations where version = '0082';

commit;
