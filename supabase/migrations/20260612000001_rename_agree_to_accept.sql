-- Rename mark_stance enum value 'agree' → 'accept' to match product terminology.
-- ALTER TYPE … RENAME VALUE is safe and idempotent in Postgres 10+.

alter type public.mark_stance rename value 'agree' to 'accept';
