# pebble

A minimalist, self-hosted blog CMS built on serverless infrastructure. Runs entirely on free tiers.

```
admin/ (Vercel)
       │
       ▼
api/ (Cloudflare Workers)
       │
       ├──▶ D1 (Cloudflare SQLite database)
       └──▶ R2 (Cloudflare object storage)
```

---

## Getting started

### Prerequisites
- [Node.js](https://nodejs.org/)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)
- [Vercel account](https://vercel.com/signup) (free tier is enough)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler && wrangler login`
- [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel && vercel login`

### Run the setup script

```bash
node scripts/setup.js
```

The script handles the full deployment end-to-end:
- Create a D1 database and R2 bucket in your Cloudflare account
- Update `api/wrangler.toml` with the generated IDs
- Apply the database schema
- Prompt for admin credentials and set all Cloudflare secrets
- Deploy the Worker
- Deploy the admin UI to Vercel
- Set `NEXT_PUBLIC_API_URL` on the Vercel project and redeploy
- Update `CORS_ORIGINS` with the Vercel URL and redeploy the Worker

The one manual step is enabling public access on your R2 bucket — the script will pause and tell you exactly where to do it. On first Vercel deploy you may also be prompted to select your account.

#### Options

**`--prefix`** — Namespaces all Cloudflare resources so multiple instances can coexist on the same account. Useful if you're deploying Pebble for more than one site.

```bash
node scripts/setup.js --prefix=my-site
# creates: my-site-cms-api, my-site-cms-db, my-site-cms-images
```

**`--dry-run`** — Walks through the full setup flow without creating anything. Prompts for resource names, checks Wrangler auth, and prints every command that would run and every file that would be written.

```bash
node scripts/setup.js --dry-run
node scripts/setup.js --dry-run --prefix=my-site
```

---

## Overview

Pebble is a headless blog CMS with two components:

| Directory | Purpose |
|---|---|
| `api/` | REST API (Cloudflare Workers + Hono) |
| `admin/` | Admin dashboard (Next.js) |

---

## api/

The core backend. A Cloudflare Worker built with [Hono](https://hono.dev/).

### Stack
- **Runtime**: Cloudflare Workers (V8 isolates, no Node.js)
- **Router**: Hono v4
- **Database**: Cloudflare D1 via binding (`c.env.DB`)
- **Image storage**: Cloudflare R2 via binding (`c.env.R2_BUCKET`)
- **Auth**: JWT via `jose`, bcrypt via `bcryptjs`

### Project structure
```
api/
├── wrangler.toml              # Cloudflare config, bindings, vars
├── schema.sql                 # D1 database schema
├── scripts/
│   └── hash-password.js       # Utility to generate bcrypt hashes
└── src/
    ├── index.js               # Hono app, middleware, route mounting
    ├── routes/
    │   ├── auth.js            # POST /api/auth/login
    │   ├── posts.js           # CRUD for posts
    │   └── uploads.js         # Image upload to R2
    ├── middleware/
    │   └── auth.js            # JWT verification (auth + optionalAuth)
    └── utils/
        ├── slug.js            # Title → URL slug
        └── sanitize.js        # HTML sanitization (strips XSS vectors)
```

### API Endpoints

#### Authentication
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Returns JWT token (7-day expiry) |

**Request:**
```json
{ "username": "string", "password": "string" }
```
**Response:**
```json
{ "token": "eyJ..." }
```

#### Posts
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/posts` | Optional | List posts (published by default) |
| GET | `/api/posts/by-slug/:slug` | No | Get published post by slug |
| GET | `/api/posts/by-tag/:tag` | No | List published posts by tag |
| GET | `/api/posts/:id` | No | Get post by ID |
| POST | `/api/posts` | Required | Create post |
| PUT | `/api/posts/:id` | Required | Update post |
| DELETE | `/api/posts/:id` | Required | Delete post |

**GET /api/posts query params:**
- `status` — `published` (default), `draft`, or `all` (auth required for draft/all)
- `tag` — filter by tag name
- `page` — page number (default: 1)
- `limit` — results per page (default: 20, max: 100)

**Paginated response:**
```json
{
  "posts": [...],
  "pagination": { "page": 1, "limit": 20, "total": 42, "pages": 3 }
}
```

**Post object:**
```json
{
  "id": 1,
  "title": "string",
  "slug": "string",
  "content": "HTML string",
  "status": "published | draft",
  "tags": ["string"],
  "meta_description": "string",
  "og_image": "string (URL)",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

#### Uploads
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/uploads` | Required | Upload image to R2 |

**Request:** `multipart/form-data` with field `image` (JPEG, PNG, GIF, WebP, max 5MB)

**Response:**
```json
{ "url": "https://<your-r2-public-url>/filename.jpg" }
```

#### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |

### Environment

**Secrets** (set via `wrangler secret put`, never committed):
| Secret | Description |
|---|---|
| `JWT_SECRET` | Long random string for signing JWTs |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of admin password |
| `VERCEL_DEPLOY_HOOK` | Vercel deploy hook URL (optional, triggers rebuild on publish) |

**Vars** (in `wrangler.toml`, safe to commit):
| Var | Description |
|---|---|
| `CORS_ORIGINS` | Comma-separated list of allowed origins |
| `R2_PUBLIC_URL` | Public base URL for your R2 bucket |

**Bindings** (in `wrangler.toml`):
| Binding | Type |
|---|---|
| `DB` | D1 Database |
| `R2_BUCKET` | R2 Bucket |

### Database schema

SQLite (D1). Tags are stored as a JSON array string (e.g. `["javascript","react"]`).

```sql
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft',
  tags TEXT DEFAULT '[]',
  meta_description TEXT DEFAULT '',
  og_image TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Deployment

```bash
cd api
npx wrangler deploy
```

To set or update secrets:
```bash
npx wrangler secret put SECRET_NAME
```

To apply schema to remote D1:
```bash
npx wrangler d1 execute <your-db-name> --remote --file=schema.sql
```

---

## admin/

The admin dashboard for managing blog posts.

### Stack
- **Framework**: Next.js (App Router)
- **Editor**: Tiptap (rich text with image upload support)
- **Auth**: JWT stored in localStorage, auto-logout on 401

### Features
- Login / logout
- List all posts (pagination, status badges, tags)
- Create and edit posts with a rich text editor
- Publish, save as draft, or unpublish
- Delete posts
- Tags (comma-separated input)
- SEO fields (meta description, OG image URL)
- Image upload (uploads to R2 via API, inserted into editor)

### Environment

| Var | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL of your deployed Cloudflare Worker |

### Deployment

Connect the `admin/` directory to a Vercel project and set `NEXT_PUBLIC_API_URL` in the Vercel dashboard under Environment Variables.

To deploy manually:
```bash
cd admin
vercel --prod
```

---

## Authentication flow

1. Admin submits username + password to `POST /api/auth/login`
2. API checks username against `ADMIN_USERNAME` secret
3. API compares password against `ADMIN_PASSWORD_HASH` (bcrypt)
4. On success, returns a signed JWT (7-day expiry)
5. Admin UI stores JWT in localStorage
6. All authenticated requests send `Authorization: Bearer <token>`
7. API middleware verifies JWT signature using `JWT_SECRET`
8. On 401, admin UI clears token and redirects to login

### Generating a password hash
```bash
cd api
node scripts/hash-password.js yournewpassword
# Copy the output and run:
npx wrangler secret put ADMIN_PASSWORD_HASH
```

---

## Image upload flow

1. User clicks "Image" in the Tiptap toolbar
2. File picker opens (JPEG, PNG, GIF, WebP only)
3. Admin UI POSTs the file to `POST /api/uploads` with JWT auth
4. Worker validates file type and size (max 5MB)
5. Worker generates a unique filename: `{timestamp}-{random}.{ext}`
6. Worker uploads to R2 via native binding (no S3 credentials needed)
7. Worker returns the public R2 URL
8. Tiptap inserts an `<img>` tag at the cursor position

---

## CORS

Allowed origins are configured in `wrangler.toml` under `CORS_ORIGINS` as a comma-separated list. After editing, redeploy:

```bash
npx wrangler deploy
```

---

## Vercel deploy webhook

When a post is published, the API fires a POST to the URL stored in `VERCEL_DEPLOY_HOOK`, triggering a Vercel rebuild. This is useful for statically generated frontends that consume the API. The call is made via `c.executionCtx.waitUntil()` so it doesn't block the API response.

This is optional — if `VERCEL_DEPLOY_HOOK` is not set, the behavior is skipped.

---

## Local development

### API
```bash
cd api

# Copy the example config files and fill in your values
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars

npx wrangler dev
```

Apply schema to local D1:
```bash
npx wrangler d1 execute <your-db-name> --local --file=schema.sql
```

### Admin UI
```bash
cd admin

# Copy the example env file and fill in your API URL
cp .env.local.example .env.local

npm run dev
```

Make sure `http://localhost:3000` (or your dev port) is included in `CORS_ORIGINS` in `wrangler.toml` when developing locally.

---

last updated 2.27.26
