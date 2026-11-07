-- Key/value store for site metadata. Pebble records when content last changed
-- here, so the editor can show "Changes not deployed" next to the Rebuild button.
-- Safe to run more than once. Apply to an existing database with:
--   npx wrangler d1 execute <your-db-name> --remote --file=migrations/0001_add_meta_table.sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
