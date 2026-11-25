import { isIP } from "node:net";
import { appOf } from "../analysis/apps.js";
import { config } from "../config.js";
import { apiTypeOf, getApiType, getRelease, isTrack, listApiTypes, listReleases, TYPE_RE } from "./queries.js";

/**
 * The public, read-only API: /api/v1/*. Its own shapes, built field by field from the read models, so the
 * site's internal /api/* can change freely while v1 only ever gains fields (a breaking change is /api/v2).
 *
 * Security, in order of the request:
 *  - GET/HEAD only (OPTIONS answers a preflight); nothing here reads a cookie, a token or a body, and no reply
 *    carries anything about subscribers. That is what makes `Access-Control-Allow-Origin: *` safe — and why it
 *    is set on this prefix only, never on /api/settings or /api/signin.
 *  - Rate limits before any work: per client (an IPv4 address, or an IPv6 /64, which one user can fill with
 *    addresses) and overall, so the database sees a bounded load whatever the number of clients.
 *  - Every parameter is validated against a fixed pattern or list; unknown parameters are ignored.
 *  - A cache of its own (createRunCache), so API traffic cannot evict the site's; arbitrary paging cursors are
 *    not cached, and a type that was never changed is a 404 without a database query.
 *  - Errors are fixed codes; details go to the log only.
 */

export const V1_LIMIT_PER_MINUTE = 60;
export const V1_OVERALL_PER_MINUTE = 1200;
const MAX_PAGE = 100;
const BUILD_RE = /^[\w.-]{1,80}$/;
const SEVERITIES = ["low", "medium", "high"];

/** The client a limit applies to: an IPv4 address, or the /64 network of an IPv6 address. */
export function clientKey(ip) {
  const addr = String(ip ?? "").replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (mapped) return mapped[1];
  if (isIP(addr) !== 6) return addr;
  const [head, tail = ""] = addr.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = addr.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Fixed-window counter per key. Expired windows are swept when the table is full; if it is still full, a new
 * key is refused rather than an existing one forgotten (forgetting would reset someone's limit).
 */
export function windowLimiter({ limit, windowMs, maxKeys = 50_000, now = Date.now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= t) {
      if (entry) hits.delete(key);
      if (hits.size >= maxKeys) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      if (hits.size >= maxKeys) return { ok: false, limit, remaining: 0, resetSec: Math.ceil(windowMs / 1000) };
      entry = { count: 0, reset: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return {
      ok: entry.count <= limit,
      limit,
      remaining: Math.max(0, limit - entry.count),
      resetSec: Math.max(1, Math.ceil((entry.reset - t) / 1000)),
    };
  };
}

/** Public names: the read models' "abandoned" is "pulledBack" here. */
const STATUS = { rolling: "rolling", complete: "complete", abandoned: "pulledBack" };
const status = (s) => STATUS[s] ?? "rolling";
const iso = (d) => (d ? new Date(d).toISOString() : null);
const releaseUrl = (track, build) => `${config.publicUrl}/rollouts/${track}/${encodeURIComponent(build)}`;
const typeUrl = (type) => `${config.publicUrl}/reference/${encodeURIComponent(type)}`;

export function v1Release(r) {
  return {
    track: r.channel,
    build: r.group,
    toBuild: r.toBuild ?? null,
    fromBuilds: r.fromBuilds ?? [],
    filesRemoved: !!r.removal,
    status: status(r.status),
    severity: r.severity,
    share: r.share ?? 0,
    files: r.files ?? 0,
    apiChanges: r.uniqueApiChanges ?? 0,
    loaderFlagsChanged: !!r.flagsChanged,
    firstSeenAt: iso(r.firstSeenAt),
    lastSeenAt: iso(r.lastSeenAt),
    completedAt: iso(r.completedAt),
    url: releaseUrl(r.channel, r.group),
  };
}

export function v1Change(c) {
  return {
    path: c.path,
    from: c.from ?? null,
    kind: c.kind,
    severity: c.severity,
    type: c.type ?? apiTypeOf(c.path),
    app: appOf(c.path),
    documentation: c.apiStatus ?? null,
    apiSet: c.apiSet ?? null,
    detail: c.detail || null,
    files: c.files ?? [],
  };
}

export function v1ReleaseDetail(r) {
  return {
    ...v1Release(r),
    hostFiles: (r.hosts ?? []).map((h) => ({
      file: h.path,
      host: h.hostType ?? null,
      platform: h.hostPlatform ?? null,
      fromBuild: h.fromBuild ?? null,
      toBuild: h.toBuild ?? null,
      added: !!h.added,
      removed: !!h.removed,
      status: status(h.status),
      share: h.share ?? 0,
      severity: h.severity,
      firstSeenAt: iso(h.firstSeenAt),
      completedAt: iso(h.completedAt),
    })),
    changes: (r.apiChanges ?? []).map(v1Change),
  };
}

export function v1Type(t) {
  return {
    type: t.type,
    app: t.app ?? appOf(t.type),
    documentation: t.docs?.status ?? null,
    apiSet: t.docs?.apiSet ?? null,
    severity: t.severity,
    tracks: t.channels ?? [],
    changedPaths: t.changes ?? 0,
    lastSeenAt: iso(t.lastSeenAt),
    builds: (t.builds ?? []).map((b) => ({
      build: b.group,
      tracks: b.channels ?? [],
      kinds: b.kinds ?? [],
      severity: b.severity,
      documented: !!b.documented,
      firstSeenAt: iso(b.firstSeenAt),
    })),
    url: typeUrl(t.type),
  };
}

export function v1TypeDetail(t) {
  return {
    type: t.type,
    app: appOf(t.type),
    documentation: t.docs?.status ?? null,
    apiSet: t.docs?.apiSet ?? null,
    docsUrl: t.docs?.url ?? null,
    changes: (t.events ?? []).map((e) => ({
      track: e.channel,
      build: e.group,
      status: status(e.status),
      firstSeenAt: iso(e.firstSeenAt),
      completedAt: iso(e.completedAt),
      ...v1Change(e),
      pulledBackFiles: e.pulledFiles ?? [],
    })),
    url: typeUrl(t.type),
  };
}

const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "cross-origin",
  "referrer-policy": "no-referrer",
};

/** Fastify plugin, registered with prefix /api/v1. `cached`: a run cache of its own (see the header). */
export function publicApi({ cached, perMinute = V1_LIMIT_PER_MINUTE, overallPerMinute = V1_OVERALL_PER_MINUTE }) {
  return async function v1(app) {
    const perClient = windowLimiter({ limit: perMinute, windowMs: 60_000 });
    const overall = windowLimiter({ limit: overallPerMinute, windowMs: 60_000, maxKeys: 1 });

    app.addHook("onRequest", async (req, reply) => {
      reply.headers(HEADERS);
      if (req.method === "OPTIONS") return;
      const mine = perClient(clientKey(req.ip));
      reply.header("RateLimit-Limit", mine.limit);
      reply.header("RateLimit-Remaining", mine.remaining);
      reply.header("RateLimit-Reset", mine.resetSec);
      if (!mine.ok) {
        return reply.code(429).header("Retry-After", mine.resetSec).send({ error: "rate_limited" });
      }
      const all = overall("all");
      if (!all.ok) return reply.code(429).header("Retry-After", all.resetSec).send({ error: "busy" });
    });

    // Successful answers change at most once per crawl (10 min); errors are not cached.
    app.addHook("onSend", async (_req, reply, payload) => {
      const code = reply.statusCode;
      reply.header("cache-control", code < 400 || code === 404 ? "public, max-age=60" : "no-store");
      return payload;
    });

    app.setErrorHandler((err, req, reply) => {
      const code = err.statusCode ?? 500;
      if (code >= 500) req.log.error(err);
      reply.code(code >= 500 ? 500 : code).send({ error: code >= 500 ? "internal" : "bad_request" });
    });
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));

    // A preflight only happens for non-simple requests; answer it without counting it.
    app.options("/*", async (_req, reply) =>
      reply.code(204).header("access-control-allow-methods", "GET, HEAD, OPTIONS").header("access-control-max-age", "86400").send(),
    );

    app.get("/", async () => ({
      name: "silentship public API",
      version: 1,
      docs: `${config.publicUrl}/developers`,
      endpoints: ["/api/v1/releases", "/api/v1/releases/{track}/{build}", "/api/v1/types", "/api/v1/types/{type}"],
    }));

    app.get("/releases", async (req, reply) => {
      const q = req.query ?? {};
      const track = q.track === undefined ? null : q.track;
      if (track !== null && !isTrack(track)) return reply.code(400).send({ error: "invalid_track" });
      const severity = q.severity === undefined ? null : q.severity;
      if (severity !== null && !SEVERITIES.includes(severity)) return reply.code(400).send({ error: "invalid_severity" });
      let before = null;
      if (q.before !== undefined) {
        before = typeof q.before === "string" && q.before.length <= 40 ? new Date(q.before) : new Date(NaN);
        if (Number.isNaN(before.getTime())) return reply.code(400).send({ error: "invalid_before" });
      }
      let limit = 30;
      if (q.limit !== undefined) {
        limit = /^\d{1,3}$/.test(String(q.limit)) ? Number(q.limit) : 0;
        if (limit < 1 || limit > MAX_PAGE) return reply.code(400).send({ error: "invalid_limit" });
      }
      const args = { track, severity, before, limit };
      // Only the first pages are cached: every cursor would be a new key and push the others out.
      const load = () => listReleases(args);
      const rows = before ? await load() : await cached(`v1:releases:${track}:${severity}:${limit}`, load);
      const releases = rows.map(v1Release);
      return { releases, next: releases.length === limit ? releases.at(-1).firstSeenAt : null };
    });

    app.get("/releases/:track/:build", async (req, reply) => {
      const { track, build } = req.params;
      if (!isTrack(track) || !BUILD_RE.test(build)) return reply.code(404).send({ error: "not_found" });
      const release = await cached(`v1:release:${track}/${build}`, () => getRelease(track, build));
      if (!release) return reply.code(404).send({ error: "not_found" });
      return v1ReleaseDetail(release);
    });

    const allTypes = () => cached("v1:types", listApiTypes);

    app.get("/types", async () => ({ types: (await allTypes()).map(v1Type) }));

    app.get("/types/:type", async (req, reply) => {
      const { type } = req.params;
      if (type.length > 200 || !TYPE_RE.test(type)) return reply.code(404).send({ error: "not_found" });
      // Only types some build changed have a history: anything else is a 404 without a database query.
      const known = (await allTypes()).find((t) => t.type.toLowerCase() === type.toLowerCase());
      if (!known) return reply.code(404).send({ error: "not_found" });
      const detail = await cached(`v1:type:${known.type}`, () => getApiType(known.type));
      if (!detail) return reply.code(404).send({ error: "not_found" });
      return v1TypeDetail(detail);
    });
  };
}
