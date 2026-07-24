-- 001 · Extensions
-- pg_trgm powers index I6 (card USING gin (name_normalized gin_trgm_ops)) — global
-- card search, SCHEMA §13 I6. pg_trgm is a "trusted" extension (PG13+), so the
-- pokedex role can create it as owner of this database without superuser.
-- gen_random_uuid() is in core (PG13+); no pgcrypto needed for card_list/deck UUIDs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
