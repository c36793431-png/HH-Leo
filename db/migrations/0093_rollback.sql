-- Rollback for 0093_basket_requests.sql. Not applied automatically.
-- Roll the code back first: the basket page, its submit action and /admin/basket-requests read
-- this table and fail without it.
-- Drops every basket request, handled or not. No grant was ever written from it, so no licence,
-- subscription or trial is affected; the requests themselves are lost, so export them first if any
-- is still 'new'. Since 0107, bundle_subscriptions.basket_request_id references this table: run
-- 0107_rollback.sql first, or the drop fails on that foreign key.
begin;
drop table if exists basket_requests;
delete from schema_migrations where version = '0093';
commit;
