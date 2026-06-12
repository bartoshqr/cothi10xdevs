-- S-04 Phase 1 (part 1 of 2): add `completed` to exchange_status enum.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as statements
-- that reference the new value (SQLSTATE 55P04). Splitting into a dedicated
-- migration commits the enum change so the next migration can safely use it.

alter type public.exchange_status add value 'completed';
