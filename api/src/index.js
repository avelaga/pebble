import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { authRoutes } from "./routes/auth";
import { postRoutes } from "./routes/posts";
import { uploadRoutes } from "./routes/uploads";

const app = new Hono();

// Security headers (replaces helmet)
app.use("*", secureHeaders());

// CORS
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.CORS_ORIGINS || "")
        .split(",")
        .map((o) => o.trim());
      if (!origin || allowed.includes(origin)) {
        return origin || "*";
      }
      return null;
    },
  })
);

// Routes
app.route("/api/auth", authRoutes);
app.route("/api/posts", postRoutes);
app.route("/api/uploads", uploadRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Error handling
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

export default app;
