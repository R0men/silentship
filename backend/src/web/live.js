import { config } from "../config.js";
import { db } from "../db.js";
import { homeSnapshot } from "./queries.js";

/**
 * Live updates over Server-Sent Events.
 *
 * Crawls may run in this process (`start`) or another one (`crawl` from cron), so instead of hooking the
 * crawler we watch the newest run in the database: when it starts or finishes, every connected browser
 * gets a fresh snapshot. A poll every few seconds is one indexed query, regardless of client count.
 *
 * The snapshot is the same homeSnapshot the page renders on the server, and browsers prefer it over that
 * render, so it must never be older: checks run one at a time (a slow build started before a crawl wrote
 * its data cannot finish last and overwrite a newer one), a failed build is retried on the next poll, and
 * the snapshot is rebuilt every `maxAgeMs` even without a new run.
 */

const MAX_CLIENTS = 2000;
const HEARTBEAT_MS = 25_000;

async function latestRunKey() {
  const { runs } = await db();
  const latest = await runs.findOne({ region: config.region }, { sort: { startedAt: -1 }, projection: { _id: 1, status: 1 } });
  return latest ? `${latest._id}:${latest.status}` : "none";
}

/** A snapshot's content without its timestamp: a periodic rebuild that changed nothing is not broadcast. */
const contentOf = (s) => JSON.stringify({ overview: s.overview, rollouts: s.rollouts });

export function createLiveFeed({
  pollMs = 5_000,
  maxAgeMs = 60_000,
  build = homeSnapshot,
  runKey = latestRunKey,
  now = Date.now,
} = {}) {
  const clients = new Set();
  let lastKey = null;
  let builtAt = 0;
  let snapshot = null;
  let pending = null;
  let timers = [];

  function write(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(event, data) {
    for (const res of clients) {
      try {
        write(res, event, data);
      } catch {
        clients.delete(res);
      }
    }
  }

  async function refresh() {
    try {
      const key = await runKey();
      if (snapshot && key === lastKey && now() - builtAt < maxAgeMs) return;
      const next = await build();
      const changed = !snapshot || contentOf(next) !== contentOf(snapshot);
      // Only after a successful build: a failed one leaves lastKey behind, so the next poll tries again.
      lastKey = key;
      builtAt = now();
      snapshot = next;
      if (changed) broadcast("update", snapshot);
    } catch (err) {
      console.error("live feed check failed:", String(err));
    }
  }

  /** One check at a time; a poll that comes while one runs waits for it instead of racing it. */
  function check() {
    pending ??= refresh().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    start() {
      timers = [
        setInterval(check, pollMs),
        // Comments keep proxies from closing an idle stream.
        setInterval(() => {
          for (const res of clients) res.write(": ping\n\n");
        }, HEARTBEAT_MS),
      ];
      void check();
    },
    stop() {
      for (const t of timers) clearInterval(t);
      for (const res of clients) res.end();
      clients.clear();
    },
    /** Fastify handler for GET /api/live. */
    async handle(req, reply) {
      if (clients.size >= MAX_CLIENTS) return reply.code(503).send({ error: "too_many_clients" });
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no", // nginx: do not buffer the stream
      });
      res.write("retry: 5000\n\n");
      // New clients get the current state at once instead of waiting for the next crawl; joining the
      // broadcast only after it, so the first snapshot is not sent twice.
      if (!snapshot) await check();
      if (snapshot) write(res, "update", snapshot);
      clients.add(res);
      req.raw.on("close", () => clients.delete(res));
    },
    /** Runs one check now; for tests. */
    check,
    get snapshot() {
      return snapshot;
    },
    get size() {
      return clients.size;
    },
  };
}
