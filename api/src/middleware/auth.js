import * as jose from "jose";

function getSecret(env) {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export async function auth(c, next) {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const token = header.split(" ")[1];
  try {
    const { payload } = await jose.jwtVerify(token, getSecret(c.env));
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}

export async function optionalAuth(c, next) {
  const header = c.req.header("Authorization");
  if (header && header.startsWith("Bearer ")) {
    try {
      const token = header.split(" ")[1];
      const { payload } = await jose.jwtVerify(token, getSecret(c.env));
      c.set("user", payload);
    } catch {
      // Invalid token — treat as unauthenticated
    }
  }
  await next();
}
