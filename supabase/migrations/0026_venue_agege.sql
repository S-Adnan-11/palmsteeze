-- Owner-confirmed current fictional venue district. Historical booking, price,
-- identity and payment snapshots are deliberately untouched.
update public.venue_settings set district='Agege, Lagos';
alter table public.venue_settings alter column district set default 'Agege, Lagos';
