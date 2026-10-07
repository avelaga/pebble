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

// The site's static build fetches private posts with a long-lived shared secret
// instead of an editor login, which expires.
function isBuildToken(env, token) {
  return !!env.BUILD_TOKEN && token === env.BUILD_TOKEN;
}

export async function optionalAuth(c, next) {
  const header = c.req.header("Authorization");
  if (header && header.startsWith("Bearer ")) {
    const token = header.split(" ")[1];
    if (isBuildToken(c.env, token)) {
      c.set("build", true);
      return next();
    }
    try {
      const { payload } = await jose.jwtVerify(token, getSecret(c.env));
      c.set("user", payload);
    } catch {
      // Invalid token — treat as unauthenticated
    }
  }
  await next();
}
