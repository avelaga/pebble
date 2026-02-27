import { Hono } from "hono";
import bcrypt from "bcryptjs";
import * as jose from "jose";

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const { username, password } = await c.req.json();

  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400);
  }

  if (username !== c.env.ADMIN_USERNAME) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const valid = await bcrypt.compare(password, c.env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const secret = new TextEncoder().encode(c.env.JWT_SECRET);
  const token = await new jose.SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);

  return c.json({ token });
});
