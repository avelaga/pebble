import { Hono } from "hono";
import { auth, optionalAuth } from "../middleware/auth";
import { toSlug } from "../utils/slug";
import { sanitizeHtml } from "../utils/sanitize";

export const postRoutes = new Hono();

// Parse tags JSON string from DB into array
function parseTags(post) {
  if (!post) return post;
  try {
    post.tags = JSON.parse(post.tags || "[]");
  } catch {
    post.tags = [];
  }
  return post;
}

function parseTagsList(posts) {
  return posts.map(parseTags);
}

function contentPreview(html) {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > 100 ? text.slice(0, 100) + "..." : text;
}

async function triggerDeploy(env) {
  const hook = env.VERCEL_DEPLOY_HOOK;
  if (!hook) return;
  try {
    await fetch(hook, { method: "POST" });
    console.log("Deploy webhook triggered");
  } catch (err) {
    console.error("Failed to trigger deploy webhook:", err);
  }
}

// GET /api/posts - list posts with pagination and tag filter
postRoutes.get("/", optionalAuth, async (c) => {
  try {
    const db = c.env.DB;
    const { status, tag, page = "1", limit = "20" } = c.req.query();
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit)));

    let where = [];
    let params = [];

    if (status === "all" || status === "draft") {
      if (!c.get("user")) {
        return c.json({ error: "Authentication required to view drafts" }, 401);
      }
      if (status === "draft") {
        where.push("status = ?");
        params.push("draft");
      }
    } else {
      where.push("status = ?");
      params.push("published");
    }

    if (tag) {
      // Search for tag in JSON array string
      where.push("tags LIKE ?");
      params.push(`%"${tag}"%`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await db
      .prepare(`SELECT COUNT(*) as count FROM posts ${whereClause}`)
      .bind(...params)
      .first();
    const total = countResult.count;

    const rows = await db
      .prepare(
        `SELECT id, title, slug, status, tags, meta_description, og_image, content, created_at, updated_at
         FROM posts ${whereClause}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...params, safeLimit, offset)
      .all();

    const posts = parseTagsList(rows.results).map((p) => {
      const preview = contentPreview(p.content);
      delete p.content;
      return { ...p, content_preview: preview };
    });

    return c.json({
      posts,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error("Error fetching posts:", err);
    return c.json({ error: "Failed to fetch posts" }, 500);
  }
});

// GET /api/posts/by-slug/:slug - get post by slug (public, published only)
postRoutes.get("/by-slug/:slug", async (c) => {
  try {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const row = await db
      .prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'")
      .bind(slug)
      .first();

    if (!row) {
      return c.json({ error: "Post not found" }, 404);
    }
    return c.json(parseTags(row));
  } catch (err) {
    console.error("Error fetching post:", err);
    return c.json({ error: "Failed to fetch post" }, 500);
  }
});

// GET /api/posts/by-tag/:tag - get published posts by tag
postRoutes.get("/by-tag/:tag", async (c) => {
  try {
    const db = c.env.DB;
    const tag = c.req.param("tag");
    const { page = "1", limit = "20" } = c.req.query();
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit)));

    const tagPattern = `%"${tag}"%`;

    const countResult = await db
      .prepare(
        "SELECT COUNT(*) as count FROM posts WHERE status = 'published' AND tags LIKE ?"
      )
      .bind(tagPattern)
      .first();
    const total = countResult.count;

    const rows = await db
      .prepare(
        `SELECT id, title, slug, status, tags, meta_description, og_image, content, created_at, updated_at
         FROM posts WHERE status = 'published' AND tags LIKE ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .bind(tagPattern, safeLimit, offset)
      .all();

    const posts = parseTagsList(rows.results).map((p) => {
      const preview = contentPreview(p.content);
      delete p.content;
      return { ...p, content_preview: preview };
    });

    return c.json({
      tag,
      posts,
      pagination: {
        page: parseInt(page),
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error("Error fetching posts by tag:", err);
    return c.json({ error: "Failed to fetch posts" }, 500);
  }
});

// GET /api/posts/:id - get single post by ID
postRoutes.get("/:id", async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param("id");
    const row = await db
      .prepare("SELECT * FROM posts WHERE id = ?")
      .bind(id)
      .first();

    if (!row) {
      return c.json({ error: "Post not found" }, 404);
    }
    return c.json(parseTags(row));
  } catch (err) {
    console.error("Error fetching post:", err);
    return c.json({ error: "Failed to fetch post" }, 500);
  }
});

// POST /api/posts - create post
postRoutes.post("/", auth, async (c) => {
  try {
    const db = c.env.DB;
    const { title, content, status, tags, meta_description, og_image } =
      await c.req.json();

    if (!title || !content) {
      return c.json({ error: "Title and content are required" }, 400);
    }

    const slug = toSlug(title);
    const cleanContent = sanitizeHtml(content);

    const result = await db
      .prepare(
        `INSERT INTO posts (title, content, slug, status, tags, meta_description, og_image)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .bind(
        title,
        cleanContent,
        slug,
        status || "draft",
        JSON.stringify(tags || []),
        meta_description || "",
        og_image || ""
      )
      .first();

    const post = parseTags(result);
    if (post.status === "published") {
      c.executionCtx.waitUntil(triggerDeploy(c.env));
    }
    return c.json(post, 201);
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return c.json({ error: "A post with this title already exists" }, 409);
    }
    console.error("Error creating post:", err);
    return c.json({ error: "Failed to create post" }, 500);
  }
});

// PUT /api/posts/:id - update post
postRoutes.put("/:id", auth, async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param("id");
    const { title, content, status, tags, meta_description, og_image } =
      await c.req.json();

    const fields = [];
    const values = [];

    if (title !== undefined) {
      fields.push("title = ?");
      values.push(title);
      fields.push("slug = ?");
      values.push(toSlug(title));
    }
    if (content !== undefined) {
      fields.push("content = ?");
      values.push(sanitizeHtml(content));
    }
    if (status !== undefined) {
      fields.push("status = ?");
      values.push(status);
    }
    if (tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(tags));
    }
    if (meta_description !== undefined) {
      fields.push("meta_description = ?");
      values.push(meta_description);
    }
    if (og_image !== undefined) {
      fields.push("og_image = ?");
      values.push(og_image);
    }

    if (fields.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    fields.push("updated_at = datetime('now')");
    values.push(id);

    const result = await db
      .prepare(
        `UPDATE posts SET ${fields.join(", ")} WHERE id = ? RETURNING *`
      )
      .bind(...values)
      .first();

    if (!result) {
      return c.json({ error: "Post not found" }, 404);
    }

    const post = parseTags(result);
    if (post.status === "published") {
      c.executionCtx.waitUntil(triggerDeploy(c.env));
    }
    return c.json(post);
  } catch (err) {
    console.error("Error updating post:", err);
    return c.json({ error: "Failed to update post" }, 500);
  }
});

// DELETE /api/posts/:id - delete post
postRoutes.delete("/:id", auth, async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param("id");
    const result = await db
      .prepare("DELETE FROM posts WHERE id = ? RETURNING id")
      .bind(id)
      .first();

    if (!result) {
      return c.json({ error: "Post not found" }, 404);
    }
    return c.json({ message: "Post deleted" });
  } catch (err) {
    console.error("Error deleting post:", err);
    return c.json({ error: "Failed to delete post" }, 500);
  }
});
