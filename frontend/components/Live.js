"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * One Server-Sent Events connection per tab (`/api/live`, proxied to the backend). The backend pushes a
 * snapshot { overview, rollouts, at } whenever a crawl starts or finishes; EventSource reconnects on its own.
 */

const LiveContext = createContext({ data: null, connected: false, listeners: null });

export function LiveProvider({ children }) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set());

  useEffect(() => {
    const source = new EventSource("/api/live");
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("update", (e) => {
      try {
        const snapshot = JSON.parse(e.data);
        setData(snapshot);
        setConnected(true);
        for (const fn of listeners.current) fn(snapshot);
      } catch {
        // A malformed frame is skipped; the next one replaces it.
      }
    });
    return () => source.close();
  }, []);

  return (
    <LiveContext.Provider value={{ data, connected, listeners: listeners.current }}>{children}</LiveContext.Provider>
  );
}

/** Latest live snapshot, or `initial` (server-rendered) until the first event arrives. */
export function useLive(initial) {
  const { data, connected } = useContext(LiveContext);
  return { data: data ?? initial, connected, live: data !== null };
}

/** Call `fn(snapshot)` on every update after mount (not for the snapshot sent on connect). */
export function useLiveEvent(fn) {
  const { listeners } = useContext(LiveContext);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!listeners) return;
    let first = true;
    const handler = (snapshot) => {
      if (first) {
        first = false; // the connect-time snapshot matches what the server just rendered
        return;
      }
      ref.current(snapshot);
    };
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, [listeners]);
}

/** Re-render the current server page when new data arrives (detail pages). */
export function LiveRefresh() {
  const router = useRouter();
  useLiveEvent(() => router.refresh());
  return null;
}

export function LiveBadge() {
  const { connected } = useContext(LiveContext);
  return (
    <span
      className={`live-badge${connected ? " on" : ""}`}
      title={connected ? "Receiving live updates" : "Reconnecting…"}
    >
      <span className="dot" />
      {connected ? "Live" : "Offline"}
    </span>
  );
}

/** Tweens between values so live changes are visible instead of jumping. */
export function AnimatedNumber({ value, format = (v) => String(Math.round(v)), duration = 900 }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    let frame;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = b;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <span suppressHydrationWarning>{format(shown)}</span>;
}
