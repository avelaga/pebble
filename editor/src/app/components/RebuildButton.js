"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const POLL_INTERVAL = 4000;

const STATE_LABELS = {
  QUEUED: "Queued…",
  INITIALIZING: "Initializing…",
  BUILDING: "Building…",
  READY: "Live",
  ERROR: "Build failed",
  CANCELED: "Canceled",
  NONE: "No builds yet",
  UNKNOWN: "Unknown",
};

export default function RebuildButton() {
  const { authFetch } = useAuth();
  const [state, setState] = useState(null);
  const [active, setActive] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pollRef = useRef(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function fetchStatus() {
    try {
      const res = await authFetch(`${API_URL}/api/deploy/status`);
      const data = await res.json();
      setState(data.state);
      setActive(data.active);
      setDirty(data.dirty);
      return data.active;
    } catch (err) {
      console.error("Failed to fetch build status:", err);
      return false;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const stillActive = await fetchStatus();
      if (!stillActive) stopPolling();
    }, POLL_INTERVAL);
  }

  // Check status on mount, on window focus, and whenever a post changes
  // (PostList dispatches "pebble:content-changed" after edits/deletes).
  useEffect(() => {
    function refresh() {
      fetchStatus().then((stillActive) => {
        if (stillActive) startPolling();
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pebble:content-changed", refresh);
    return () => {
      stopPolling();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pebble:content-changed", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function rebuild() {
    setActive(true);
    setState("QUEUED");
    try {
      const res = await authFetch(`${API_URL}/api/deploy/rebuild`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to trigger rebuild");
      startPolling();
    } catch (err) {
      console.error("Failed to trigger rebuild:", err);
      setActive(false);
      setState("ERROR");
    }
  }

  const label = state ? STATE_LABELS[state] || state : null;
  const statusClass = state ? state.toLowerCase() : "";

  // While a build runs, show its state; otherwise warn if there are
  // undeployed changes, else show the last build's state.
  let indicator = null;
  if (active) {
    indicator = <span className={`build-status ${statusClass}`}>{label}</span>;
  } else if (dirty) {
    indicator = (
      <span className="build-status dirty">● Changes not deployed</span>
    );
  } else if (label) {
    indicator = <span className={`build-status ${statusClass}`}>{label}</span>;
  }

  return (
    <div className="rebuild-control">
      <button onClick={rebuild} disabled={active} className="rebuild-btn">
        {active ? "Rebuilding…" : "Rebuild site"}
      </button>
      {indicator}
    </div>
  );
}
