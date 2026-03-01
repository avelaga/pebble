# pebble

A minimalist self-hosted headless blog CMS. Runs entirely on free tiers - no server, no monthly bill.

<img src="https://i.imgur.com/rq5lrhG.png"/>
<img src="https://i.imgur.com/eUlTOXo.png"/>

Most headless CMS platforms require a live server (Ghost, Strapi, Payload all need a VPS at ~$6–12/month minimum). Pebble runs entirely on Cloudflare - Workers, D1, R2, and Pages - meaning it deploys globally, scales automatically, and costs nothing on free tiers. A single setup script handles everything end-to-end.

## Features

- **REST API** - clean endpoints for posts, slugs, tags, and image uploads
- **Draft / publish workflow** - public reads return only published posts; authenticated reads include drafts
- **Auto-deploy on publish** - optional deploy hook triggers a frontend rebuild whenever you publish a post, making it a first-class citizen in any SSG workflow (Next.js, Astro, SvelteKit, etc.)
- **Image uploads** - stored in R2, served from a public URL, no egress fees
- **SEO fields** - title, description, and OG fields baked in
- **Tags** - lightweight taxonomy, no configuration needed
- **JWT auth** - 7-day tokens, bcrypt-hashed credentials stored as Cloudflare secrets
- **HTML sanitization** - safe rich text output from the editor
- **Multi-instance support** - namespace all resources with `--prefix` to run multiple sites on one account
- **One-command setup** - full deployment automated via a single script

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18.18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)

### Run the setup script
```bash
node scripts/setup.js
```

Handles the full deployment end-to-end: creates Cloudflare resources, applies the schema, sets secrets, deploys the Worker and editor, and wires up CORS. The script will try to enable public access on your R2 bucket automatically - if it can't, it'll tell you where to do it manually.

#### Options

**`--prefix`** - Namespaces all resources so multiple instances can coexist on the same account.
```bash
node scripts/setup.js --prefix=my-site
# creates: my-site-pebble-api, my-site-pebble-db, my-site-pebble-images, my-site-pebble-editor
```

---

## API

Cloudflare Worker built with [Hono](https://hono.dev/). Uses D1 (SQLite) for posts and R2 for image storage. Auth is JWT + bcrypt.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | - | Returns JWT (7-day expiry) |
| GET | `/api/posts` | Optional | List posts. Params: `status`, `tag`, `page`, `limit` |
| GET | `/api/posts/:id` | - | Get post by ID |
| GET | `/api/posts/by-slug/:slug` | - | Get post by slug |
| GET | `/api/posts/by-tag/:tag` | - | List posts by tag |
| POST | `/api/posts` | Required | Create post |
| PUT | `/api/posts/:id` | Required | Update post |
| DELETE | `/api/posts/:id` | Required | Delete post |
| POST | `/api/uploads` | Required | Upload image (JPEG/PNG/GIF/WebP, max 5MB) |
| GET | `/health` | - | Health check |

Auth is optional on `GET /api/posts` - unauthenticated requests return only published posts, authenticated requests include drafts.

### Project structure
```
api/
├── wrangler.toml              # Cloudflare config, bindings, vars
├── schema.sql                 # D1 database schema
├── scripts/
│   └── reset-password.js      # Interactive password reset
└── src/
    ├── index.js               # Hono app, middleware, route mounting
    ├── routes/
    │   ├── auth.js            # POST /api/auth/login
    │   ├── posts.js           # CRUD for posts
    │   └── uploads.js         # Image upload to R2
    ├── middleware/
    │   └── auth.js            # JWT verification
    └── utils/
        ├── slug.js            # Title → URL slug
        └── sanitize.js        # HTML sanitization
```

### Environment

**Secrets** (set via `wrangler secret put`):

| Secret | Description |
|---|---|
| `JWT_SECRET` | Random string for signing JWTs |
| `EDITOR_USERNAME` | Editor login username |
| `EDITOR_PASSWORD_HASH` | bcrypt hash of editor password |
| `DEPLOY_HOOK` | Deploy hook URL to trigger frontend rebuilds (optional) |

**Vars** (`wrangler.toml`):

| Var | Description |
|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `R2_PUBLIC_URL` | Public base URL for your R2 bucket |

### Deploy
```bash
cd api && npx wrangler deploy
```

### Reset credentials
```bash
cd api && npm run reset-password
```

---

## Editor

Next.js editor UI deployed to [Cloudflare Workers](https://workers.cloudflare.com/) via [OpenNext](https://opennext.js.org/cloudflare). Uses Tiptap for rich text editing, JWT for auth.

**Features:** create/edit/delete posts, publish or draft, tags, SEO fields, image upload.

### Environment

| Var | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL of your deployed Cloudflare Worker (baked in at build time) |

### Deploy
```bash
cd editor
npm install && npm run cf:build
npx wrangler deploy
```

---

## Local development

### API
```bash
cd api
cp wrangler.toml.example wrangler.toml
cp .dev.vars.example .dev.vars
npx wrangler d1 execute <your-db-name> --local --file=schema.sql
npx wrangler dev
```

### Editor
```bash
cd editor
cp .env.local.example .env.local
npm run dev
```

Make sure `http://localhost:3000` is in `CORS_ORIGINS` in `wrangler.toml`.

---

## Deploy hook

Set `DEPLOY_HOOK` as a Worker secret to trigger a rebuild of your frontend whenever a post is published. Works with any platform that supports deploy hooks - Cloudflare Pages, Vercel, Netlify, etc.

```bash
cd api && npx wrangler secret put DEPLOY_HOOK
```

---

## Notes

Pebble is intentionally single-editor. If you need multi-author support, fork it.

JWT tokens are stored in localStorage. This is a deliberate trade-off: httpOnly cookies don't work cleanly cross-origin between Cloudflare Pages and Workers, and for a personal CMS the attack surface is minimal.

Pebble runs on Cloudflare free tiers, which are subject to change. Current limits are well above what any blog will realistically hit.
