import { Hono } from "hono";
import { auth } from "../middleware/auth";

export const deployRoutes = new Hono();

// States Vercel reports while a build is still in progress
const ACTIVE_STATES = ["QUEUED", "INITIALIZING", "BUILDING"];

// POST /api/deploy/rebuild - manually trigger a Vercel build via deploy hook
deployRoutes.post("/rebuild", auth, async (c) => {
  const hook = c.env.DEPLOY_HOOK;
  if (!hook) {
    return c.json({ error: "Deploy hook not configured" }, 500);
  }
  try {
    const res = await fetch(hook, { method: "POST" });
    if (!res.ok) {
      const body = await res.text();
      console.error("Deploy hook returned", res.status, body);
      return c.json({ error: "Failed to trigger rebuild" }, 502);
    }
    return c.json({ message: "Rebuild triggered" });
  } catch (err) {
    console.error("Failed to trigger deploy hook:", err);
    return c.json({ error: "Failed to trigger rebuild" }, 502);
  }
});

// GET /api/deploy/status - status of the latest Vercel deployment
deployRoutes.get("/status", auth, async (c) => {
  const token = c.env.VERCEL_TOKEN;
  const projectId = c.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return c.json({ error: "Vercel API not configured" }, 500);
  }

  const params = new URLSearchParams({ projectId, limit: "1" });
  if (c.env.VERCEL_TEAM_ID) params.set("teamId", c.env.VERCEL_TEAM_ID);

  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Vercel API error", res.status, body);
      return c.json({ error: "Failed to fetch build status" }, 502);
    }

    const data = await res.json();
    const latest = data.deployments && data.deployments[0];

    // When did content last change (UTC text), in ms — null if never tracked
    const marker = await c.env.DB.prepare(
      "SELECT value FROM meta WHERE key = 'content_changed_at'"
    ).first();
    const changedAtMs = marker?.value
      ? new Date(marker.value + "Z").getTime()
      : null;

    if (!latest) {
      return c.json({
        state: "NONE",
        active: false,
        dirty: changedAtMs !== null,
        changedAt: marker?.value || null,
      });
    }

    const state = latest.state || latest.readyState || "UNKNOWN";
    const deployedAtMs = latest.created || latest.createdAt || null;
    // Dirty when content changed after the most recent deploy started
    const dirty =
      changedAtMs !== null &&
      (deployedAtMs === null || changedAtMs > deployedAtMs);

    return c.json({
      state,
      active: ACTIVE_STATES.includes(state),
      dirty,
      changedAt: marker?.value || null,
      url: latest.url ? `https://${latest.url}` : null,
      createdAt: deployedAtMs,
      deploymentId: latest.uid || latest.id || null,
    });
  } catch (err) {
    console.error("Failed to fetch Vercel status:", err);
    return c.json({ error: "Failed to fetch build status" }, 502);
  }
});
