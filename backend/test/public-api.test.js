import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The public API against stubbed read models: shapes, validation, headers, limits. */
const release = {
  channel: "prod",
  group: "16.0.3",
  toBuild: "16.0.3",
  fromBuilds: ["16.0.2"],
  removal: false,
  status: "abandoned",
  severity: "high",
  share: 0.5,
  files: 2,
  uniqueApiChanges: 1,
  apiChangeCount: 3,
  flagsChanged: false,
  firstSeenAt: new Date("2026-11-01T10:00:00Z"),
  lastSeenAt: new Date("2026-11-02T10:00:00Z"),
  completedAt: null,
  region: "internal-region",
  diverged: false,
  hosts: [{ path: "excel-web-16.00.js", hostType: "excel", hostPlatform: "web", status: "rolling", share: 0.5, severity: "high", history: [[1, 0.5]] }],
  apiChanges: [
    { path: "Excel.Range.foo", from: null, kind: "removed", severity: "high", apiStatus: "ga", apiSet: "ExcelApi 1.1", detail: "", files: ["excel-web-16.00.js"], lowered: [] },
    { path: "Office.MailboxEnums.ItemType.Bar", kind: "added", severity: "low", apiStatus: "undocumented", detail: "property", files: [] },
  ],
};
const types = [{ type: "Excel.Range", namespace: "Excel", app: "Excel", channels: ["prod"], changes: 1, severity: "high", docs: { status: "ga", apiSet: "ExcelApi 1.1" }, lastSeenAt: new Date("2026-11-01T10:00:00Z"), builds: [{ group: "16.0.3", channels: ["prod"], kinds: ["removed"], severity: "high", documented: true, firstSeenAt: new Date("2026-11-01T10:00:00Z") }] }];

const listReleases = vi.fn(async ({ limit }) => Array.from({ length: Math.min(limit, 2) }, () => release));
const getApiType = vi.fn(async (type) => ({
  type,
  docs: { status: "ga", apiSet: "ExcelApi 1.1", url: "https://learn.microsoft.com/x" },
  events: [{ ...release.apiChanges[0], channel: "prod", group: "16.0.3", status: "complete", pulledFiles: [], firstSeenAt: release.firstSeenAt }],
}));
vi.mock("../src/web/queries.js", () => ({
  isTrack: (t) => t === "prod" || t === "beta",
  TYPE_RE: /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,9}$/,
  apiTypeOf: (p) => p.split(".").slice(0, 2).join("."),
  listReleases: (...a) => listReleases(...a),
  getRelease: async (track, group) => (track === "prod" && group === "16.0.3" ? release : null),
  listApiTypes: async () => types,
  getApiType: (...a) => getApiType(...a),
}));

const { clientKey, publicApi, windowLimiter } = await import("../src/web/public-api.js");

let app;
const noCache = (_key, build) => build();
async function start(opts = {}) {
  app = Fastify({ trustProxy: "loopback" });
  await app.register(publicApi({ cached: noCache, ...opts }), { prefix: "/api/v1" });
  app.get("/api/private", async () => ({ secret: true }));
  return app;
}
const get = (url, headers = {}) => app.inject({ method: "GET", url, headers });

beforeEach(() => {
  listReleases.mockClear();
  getApiType.mockClear();
});
afterEach(async () => app?.close());

describe("public API v1", () => {
  it("serves releases in the public shape only, with a paging cursor", async () => {
    await start();
    const res = await get("/api/v1/releases?limit=2");
    expect(res.statusCode).toBe(200);
    const { releases, next } = res.json();
    expect(Object.keys(releases[0]).sort()).toEqual(
      ["apiChanges", "build", "completedAt", "files", "filesRemoved", "firstSeenAt", "fromBuilds", "lastSeenAt", "loaderFlagsChanged", "severity", "share", "status", "toBuild", "track", "url"].sort(),
    );
    expect(releases[0]).toMatchObject({ track: "prod", build: "16.0.3", status: "pulledBack", apiChanges: 1 });
    expect(next).toBe("2026-11-01T10:00:00.000Z");
    expect(JSON.stringify(res.json())).not.toContain("internal-region");
  });

  it("serves a release with its changes and host files, nothing internal", async () => {
    await start();
    const body = (await get("/api/v1/releases/prod/16.0.3")).json();
    expect(body.changes[0]).toEqual({
      path: "Excel.Range.foo",
      from: null,
      kind: "removed",
      severity: "high",
      type: "Excel.Range",
      app: "Excel",
      documentation: "ga",
      apiSet: "ExcelApi 1.1",
      detail: null,
      files: ["excel-web-16.00.js"],
    });
    expect(body.changes[1].app).toBe("Outlook");
    expect(body.hostFiles[0]).not.toHaveProperty("history");
    expect(JSON.stringify(body)).not.toMatch(/internal-region|lowered|diverged/);
    expect((await get("/api/v1/releases/prod/16.0.9")).statusCode).toBe(404);
    expect((await get("/api/v1/releases/onecdn-prod/16.0.3")).statusCode).toBe(404);
  });

  it("validates every parameter and answers errors with fixed codes", async () => {
    await start();
    expect((await get("/api/v1/releases?track=onecdn-prod")).json()).toEqual({ error: "invalid_track" });
    expect((await get("/api/v1/releases?severity=critical")).json()).toEqual({ error: "invalid_severity" });
    expect((await get("/api/v1/releases?limit=1000")).json()).toEqual({ error: "invalid_limit" });
    expect((await get("/api/v1/releases?limit=1e2")).json()).toEqual({ error: "invalid_limit" });
    expect((await get("/api/v1/releases?before=yesterday")).json()).toEqual({ error: "invalid_before" });
    expect((await get("/api/v1/releases?before=a&before=b")).json()).toEqual({ error: "invalid_before" });
    expect((await get("/api/v1/nope")).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/v1/releases" })).statusCode).toBe(404);
    expect(listReleases).not.toHaveBeenCalled();
  });

  it("answers an unknown type without a database query", async () => {
    await start();
    expect((await get("/api/v1/types/Excel.Nope")).statusCode).toBe(404);
    expect((await get("/api/v1/types/Excel.Range;drop")).statusCode).toBe(404);
    expect(getApiType).not.toHaveBeenCalled();
    const ok = (await get("/api/v1/types/excel.range")).json();
    expect(getApiType).toHaveBeenCalledWith("Excel.Range");
    expect(ok).toMatchObject({ type: "Excel.Range", app: "Excel", documentation: "ga" });
    expect(ok.changes[0]).toMatchObject({ track: "prod", build: "16.0.3", path: "Excel.Range.foo", pulledBackFiles: [] });
    expect((await get("/api/v1/types")).json().types[0]).toMatchObject({ type: "Excel.Range", tracks: ["prod"] });
  });

  it("allows any origin to read, never with credentials, and only on /api/v1", async () => {
    await start();
    const res = await get("/api/v1/types", { origin: "https://evil.example" });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    const pre = await app.inject({ method: "OPTIONS", url: "/api/v1/types", headers: { origin: "https://x.example", "access-control-request-method": "GET" } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-methods"]).toBe("GET, HEAD, OPTIONS");
    expect((await get("/api/private")).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("limits each client, by the address nginx forwards and by IPv6 /64", async () => {
    await start({ perMinute: 3 });
    const as = (ip) => get("/api/v1/types", { "x-forwarded-for": ip });
    for (let i = 0; i < 3; i++) expect((await as("203.0.113.7")).statusCode).toBe(200);
    const limited = await as("203.0.113.7");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect((await as("203.0.113.8")).statusCode).toBe(200);

    for (let i = 0; i < 3; i++) expect((await as(`2001:db8:1:2::${i + 1}`)).statusCode).toBe(200);
    expect((await as("2001:db8:1:2:ffff::9")).statusCode).toBe(429);
    expect((await as("2001:db8:1:3::1")).statusCode).toBe(200);
  });

  it("caps the total load whatever the number of clients", async () => {
    await start({ overallPerMinute: 2 });
    expect((await get("/api/v1/types", { "x-forwarded-for": "198.51.100.1" })).statusCode).toBe(200);
    expect((await get("/api/v1/types", { "x-forwarded-for": "198.51.100.2" })).statusCode).toBe(200);
    expect((await get("/api/v1/types", { "x-forwarded-for": "198.51.100.3" })).json()).toEqual({ error: "busy" });
  });

  it("hides internal errors", async () => {
    await start();
    listReleases.mockRejectedValueOnce(new Error("MongoServerError: secret detail"));
    const res = await get("/api/v1/releases");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "internal" });
  });
});

describe("limits", () => {
  it("keys IPv6 by /64 and IPv4 by address", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(clientKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("refuses new keys when full instead of forgetting a limited one", () => {
    let t = 0;
    const limit = windowLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => t });
    expect(limit("a").ok).toBe(true);
    expect(limit("a").ok).toBe(false);
    expect(limit("b").ok).toBe(true);
    expect(limit("c").ok).toBe(false);
    expect(limit("a").ok).toBe(false);
    t = 1000;
    expect(limit("c").ok).toBe(true);
    expect(limit("a").ok).toBe(true);
  });
});
