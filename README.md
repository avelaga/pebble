# pebble

A minimalist, self-hosted headless blog CMS built on serverless infrastructure and that runs entirely on free tiers.

<img src="https://i.imgur.com/rq5lrhG.png"/>
<img src="https://i.imgur.com/bMOmQPV.png"/>

---

## Getting started

### Prerequisites
- [Node.js](https://nodejs.org/) 18.18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)
- [Vercel account](https://vercel.com/signup) (free tier is enough)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler && wrangler login`
- [Vercel CLI](https://vercel.com/docs/cli): `npm install -g vercel && vercel login`

### Run the setup script

```bash
node scripts/setup.js
```

Handles the full deployment end-to-end: creates Cloudflare resources, applies the schema, sets secrets, deploys the Worker and editor, and wires up CORS. The script will try to enable public access on your R2 bucket automatically - if it can't, it'll tell you where to do it manually.

#### Options

**`--prefix`** - Namespaces all resources so multiple instances can coexist on the same account.

```bash
node scripts/setup.js --prefix=my-site
# creates: my-site-pebble-api, my-site-pebble-db, my-site-pebble-images
```

---

## api/

Cloudflare Worker built with [Hono](https://hono.dev/). Uses D1 (SQLite) for posts and R2 for image storage. Auth is JWT + bcrypt.

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
    │   └── auth.js            # JWT verification
    └── utils/
        ├── slug.js            # Title → URL slug
        └── sanitize.js        # HTML sanitization
```

### API Endpoints

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

### Environment

**Secrets** (`wrangler secret put`):

| Secret | Description |
|---|---|
| `JWT_SECRET` | Random string for signing JWTs |
| `EDITOR_USERNAME` | Editor login username |
| `EDITOR_PASSWORD_HASH` | bcrypt hash of editor password |
| `VERCEL_DEPLOY_HOOK` | Vercel deploy hook URL (optional) |

**Vars** (`wrangler.toml`):

| Var | Description |
|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `R2_PUBLIC_URL` | Public base URL for your R2 bucket |

### Deployment

```bash
cd api && npx wrangler deploy
```

### Auto-deploy on push

`.github/workflows/deploy-api.yml` redeploys the Worker on pushes to `main` that touch `api/`. Add a `CLOUDFLARE_API_TOKEN` secret to your GitHub repo (create one from the "Edit Cloudflare Workers" template in the Cloudflare dashboard).

### Updating credentials

```bash
cd api
node scripts/hash-password.js yournewpassword
npx wrangler secret put EDITOR_PASSWORD_HASH
```

---

## editor/

Next.js editor UI (App Router). Uses Tiptap for rich text editing, JWT in localStorage for auth.

**Features:** create/edit/delete posts, publish or draft, tags, SEO fields, image upload.

### Environment

| Var | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL of your deployed Cloudflare Worker |

### Deployment

```bash
cd editor && vercel --prod
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

## Vercel deploy hook

Set `VERCEL_DEPLOY_HOOK` as a Worker secret to trigger a Vercel rebuild whenever a post is published. Useful for statically generated frontends.

---

last updated 2.28.26
