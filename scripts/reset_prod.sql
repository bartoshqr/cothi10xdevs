-- Full prod reset: wipes all app data AND all auth.users accounts.
-- Order respects FK dependencies (children before parents); the final
-- delete from auth.users is a defensive double-clear since every table
-- already cascades from auth.users or public.debates.
delete from public.marks;
delete from public.exchanges;
delete from public.relations;
delete from public.nodes;
delete from public.debates;
delete from public.profiles;
delete from auth.users;
