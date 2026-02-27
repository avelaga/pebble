# Blog Service Architecture Wiki

## Overview

A headless blog platform built entirely on serverless infrastructure. The system consists of a Cloudflare Workers API, a Next.js admin dashboard, and a public-facing blog (TBD). All infrastructure runs at $0/month on free tiers.

```
blog-admin-ui (Vercel)
       │
       ▼
blog-api-workers (Cloudflare Workers)
       │
       ├──▶ D1 (Cloudflare SQLite database)
       └──▶ R2 (Cloudflare object storage)
```

---

## Repositories

| Repo | Purpose | Status |
|---|---|---|
| `blog-api-workers` | REST API (Cloudflare Workers) | Live |
| `blog-admin-ui` | Admin dashboard (Next.js) | Live |
| `blog-api` | Original Express API | Deprecated (kept for reference) |
| `blog-ui` | Test frontend (Next.js) | Test only |

---

## Infrastructure

| Service | Provider | URL | Cost |
|---|---|---|---|
| API | Cloudflare Workers | `https://blog-api.abhinav-velaga.workers.dev` | Free |
| Database | Cloudflare D1 (SQLite) | — | Free |
| Image storage | Cloudflare R2 | `https://pub-b37d0a769e6c424fb7e7693dca4e9c4e.r2.dev` | Free |
| Admin UI | Vercel | `https://admin.abhi.work` | Free |

---

## blog-api-workers

The core backend. A Cloudflare Worker written with the [Hono](https://hono.dev/) framework.

### Stack
- **Runtime**: Cloudflare Workers (V8 isolates, no Node.js)
- **Router**: Hono v4
- **Database**: Cloudflare D1 via binding (`c.env.DB`)
- **Image storage**: Cloudflare R2 via binding (`c.env.R2_BUCKET`)
- **Auth**: JWT via `jose`, bcrypt via `bcryptjs`

### Project structure
```
blog-api-workers/
├── wrangler.toml              # Cloudflare config, bindings, vars
├── schema.sql                 # D1 database schema
├── scripts/
│   └── hash-password.js       # Local utility to generate bcrypt hashes
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
{ "url": "https://pub-xxx.r2.dev/filename.jpg" }
```

#### Health
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Health check |

### Environment

**Secrets** (set via `wrangler secret put`, stored in Cloudflare):
| Secret | Description |
|---|---|
| `JWT_SECRET` | Long random hex string for signing JWTs |
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of admin password |
| `VERCEL_DEPLOY_HOOK` | Vercel deploy hook URL (triggers rebuild on publish) |

**Vars** (in `wrangler.toml`, safe to commit):
| Var | Value |
|---|---|
| `CORS_ORIGINS` | Comma-separated list of allowed origins |
| `R2_PUBLIC_URL` | Public base URL for R2 images |

**Bindings** (in `wrangler.toml`):
| Binding | Type | Name |
|---|---|---|
| `DB` | D1 Database | `blog-db` |
| `R2_BUCKET` | R2 Bucket | `blog-images` |

### Database Schema

SQLite (D1). Tags stored as a JSON array string (e.g. `["javascript","react"]`).

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
cd blog-api-workers
npx wrangler deploy
```

To update secrets:
```bash
npx wrangler secret put SECRET_NAME
```

To apply schema changes to remote DB:
```bash
npx wrangler d1 execute blog-db --remote --file=schema.sql
```

---

## blog-admin-ui

The admin dashboard for creating and managing blog posts.

### Stack
- **Framework**: Next.js (App Router)
- **Editor**: Tiptap (rich text, with image upload support)
- **Auth**: JWT stored in localStorage, auto-logout on 401

### Features
- Login/logout
- List all posts (with pagination, status badges, tags)
- Create/edit posts with rich text editor
- Publish / save as draft / unpublish
- Delete posts
- Tags (comma-separated input)
- SEO fields (meta description, OG image URL)
- Image upload (uploads to R2 via API, inserts into editor)

### Environment

Set in Vercel dashboard under Environment Variables:
| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://blog-api.abhinav-velaga.workers.dev` |

### Deployment

Connected to Vercel. To redeploy manually:
```bash
cd blog-admin-ui
vercel --prod
```

---

## Authentication Flow

1. Admin submits username + password to `POST /api/auth/login`
2. API checks username against `ADMIN_USERNAME` secret
3. API compares password against `ADMIN_PASSWORD_HASH` (bcrypt)
4. On success, returns a signed JWT (7-day expiry)
5. Admin UI stores JWT in localStorage
6. All subsequent authenticated requests send `Authorization: Bearer <token>`
7. API middleware verifies JWT signature using `JWT_SECRET`
8. On 401, admin UI clears token and redirects to login

### Generating a new password hash
```bash
cd blog-api-workers
node scripts/hash-password.js yournewpassword
# Copy the output and run:
npx wrangler secret put ADMIN_PASSWORD_HASH
```

---

## Image Upload Flow

1. User clicks "Image" in the Tiptap toolbar
2. File picker opens (JPEG, PNG, GIF, WebP only)
3. Admin UI POSTs the file to `POST /api/uploads` with JWT auth
4. Worker validates file type and size (max 5MB)
5. Worker generates a unique filename: `{timestamp}-{random}.{ext}`
6. Worker uploads to R2 via native binding (no S3 credentials needed)
7. Worker returns the public R2 URL
8. Tiptap inserts an `<img>` tag at the cursor position

---

## CORS Configuration

Allowed origins are set in `wrangler.toml` under `CORS_ORIGINS`. To add a new origin:

1. Edit `wrangler.toml`
2. Run `npx wrangler deploy`

Current allowed origins:
- `https://blog-admin-ui-navy.vercel.app`
- `https://admin.abhi.work`

---

## Local Development

### API
```bash
cd blog-api-workers
# Create .dev.vars with local secrets (gitignored):
# JWT_SECRET=...
# ADMIN_USERNAME=...
# ADMIN_PASSWORD_HASH=...
npx wrangler dev
```

Apply schema to local D1:
```bash
npx wrangler d1 execute blog-db --local --file=schema.sql
```

### Admin UI
```bash
cd blog-admin-ui
# Create .env.local (gitignored):
# NEXT_PUBLIC_API_URL=http://localhost:8787
npm run dev
```

> Note: When developing locally, add `http://localhost:3000` (or whatever port) back to `CORS_ORIGINS` in `wrangler.toml`, or run `wrangler dev` and point the admin UI at the local Worker URL instead.

---

## Vercel Deploy Webhook

When a post is published or updated to published status, the API fires a POST request to the Vercel deploy hook URL stored in `VERCEL_DEPLOY_HOOK`. This triggers a rebuild of any statically generated frontend connected to the hook.

The webhook call uses `c.executionCtx.waitUntil()` so it completes after the HTTP response is returned without delaying the API response.

---

last updated 2/25/26