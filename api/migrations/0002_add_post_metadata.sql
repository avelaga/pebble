-- Subtitle, preview text, author, and per-post body format (rich text vs raw
-- HTML). Skip this file if the columns already exist; check with:
--   npx wrangler d1 execute <your-db-name> --remote --command "PRAGMA table_info(posts)"
-- Apply to an existing database with:
--   npx wrangler d1 execute <your-db-name> --remote --file=migrations/0002_add_post_metadata.sql
ALTER TABLE posts ADD COLUMN subtitle TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN preview_text TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN author TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN format TEXT DEFAULT 'rich';
