CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft',
  subtitle TEXT DEFAULT '',
  preview_text TEXT DEFAULT '',
  author TEXT DEFAULT '',
  format TEXT DEFAULT 'rich',
  tags TEXT DEFAULT '[]',
  meta_description TEXT DEFAULT '',
  og_image TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Key/value store for site metadata (e.g. last content change vs last deploy)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
