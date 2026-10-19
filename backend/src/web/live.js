import { config } from "../config.js";
import { db } from "../db.js";
import { listReleases, overview } from "./queries.js";

/**
 * Live updates over Server-Sent Events.
 *
 * Crawls may run in this process (`start`) or another one (`crawl` from cron), so instead of hooking the
 * crawler we watch the newest run in the database: when it starts or finishes, every connected browser
 * gets a fresh snapshot. A poll every few seconds is one indexed query, regardless of client count.
 */

const MAX_CLIENTS = 2000;
const HEARTBEAT_MS = 25_000;

export function createLiveFeed({ pollMs = 5_000 } = {}) {
  const clients = new Set();
  let lastKey = null;
  let snapshot = null;
  let timers = [];

  async function buildSnapshot() {
    const [ov, rollouts] = await Promise.all([overview(), listReleases({ limit: 30 })]);
    return { overview: ov, rollouts, at: new Date().toISOString() };
  }

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

  async function check() {
    try {
      const { runs } = await db();
      const latest = await runs.findOne(
        { region: config.region },
        { sort: { startedAt: -1 }, projection: { _id: 1, status: 1 } },
      );
      const key = latest ? `${latest._id}:${latest.status}` : "none";
      if (key === lastKey) return;
      lastKey = key;
      snapshot = await buildSnapshot();
      broadcast("update", snapshot);
    } catch (err) {
      console.error("live feed check failed:", String(err));
    }
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
      clients.add(res);
      req.raw.on("close", () => clients.delete(res));
      // New clients get the current state at once instead of waiting for the next crawl.
      try {
        snapshot ??= await buildSnapshot();
        write(res, "update", snapshot);
      } catch (err) {
        console.error("live feed snapshot failed:", String(err));
      }
    },
    get size() {
      return clients.size;
    },
  };
}
