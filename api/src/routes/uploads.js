import { Hono } from "hono";
import { auth } from "../middleware/auth";

export const uploadRoutes = new Hono();

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

uploadRoutes.post("/", auth, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("image");

  if (!file || !(file instanceof File)) {
    return c.json({ error: "No image file provided" }, 400);
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json(
      { error: "Only JPEG, PNG, GIF, and WebP images are allowed" },
      400
    );
  }

  if (file.size > MAX_SIZE) {
    return c.json({ error: "File too large (max 5MB)" }, 400);
  }

  // Generate unique filename
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const randomHex = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const filename = `${Date.now()}-${randomHex}.${ext}`;

  // Upload directly to R2 via binding
  await c.env.R2_BUCKET.put(filename, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const url = `${c.env.R2_PUBLIC_URL}/${filename}`;
  return c.json({ url });
});
