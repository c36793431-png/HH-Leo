-- Brand scrub on strategy_setfiles per marcus/coxwell dispatch 2026-08-06: card names
-- leaked internal agent names ("Fable starter", "coxwell's default") to end users. Renamed
-- to the neutral "Example — <variant>" pattern used across the rest of the portal. The
-- "source" column values ('example' / 'verified') were already neutral and are unchanged --
-- only the UI label ("Example / AI-generated" -> "Example") needed a copy fix, done in code.
update strategy_setfiles set name = 'Example — conservative' where strategy_key = '1leg';
update strategy_setfiles set name = 'Example — conservative' where strategy_key = '2leg_lock';
update strategy_setfiles set name = 'Example — conservative' where strategy_key = 'trend_impulse';
update strategy_setfiles set name = 'Example — starter' where strategy_key = 'obi';
update strategy_setfiles set name = 'Example — default' where strategy_key = 'grid';

insert into schema_migrations (version, name) values
  ('0025', '0025_strategy_setfiles_brand_scrub.sql')
on conflict (version) do nothing;
