-- Private (unlisted) posts: published and reachable by direct URL, but left
-- out of every public listing. Apply to an existing database with:
--   npx wrangler d1 execute <your-db-name> --remote --file=migrations/0001_add_private.sql
ALTER TABLE posts ADD COLUMN private INTEGER DEFAULT 0;
