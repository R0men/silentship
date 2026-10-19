import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * Releases (one per track and build, both endpoints) against an in-memory MongoDB. Env is set before
 * config.js loads; CHANNELS explicitly, whatever a local .env says.
 */
let mongo;
let q;

const base = Date.now() - 6 * 3600_000;
const at = (min) => new Date(base + min * 60_000);
// Seen in two runs: a confirmed group.
const seen = (min) => [0.25, 0.5].map((share, i) => ({ at: at(min + i * 10), share }));
const roll = (o) => ({
  region: "test",
  fromSha: "a",
  fromBuild: "16.0.4",
  severity: "low",
  apiChangeCount: 0,
  status: "rolling",
  share: 0.5,
  recentShare: 0.5,
  lastSeenAt: at(300),
  history: seen(o.firstMin ?? 0),
  firstSeenAt: at(o.firstMin ?? 0),
  toBuild: o.group,
  ...o,
});

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "releases-test";
  process.env.REGION = "test";
  process.env.CHANNELS = "prod,beta,onecdn-prod,onecdn-beta";
  q = await import("../src/web/queries.js");
  const { rollouts, fileStates } = await (await import("../src/db.js")).db();
  await rollouts.insertMany([
    // 16.0.5: complete on legacy; OneCDN was added later and started on it (baseline, no rollout there).
    roll({ channel: "prod", group: "16.0.5", path: "excel-web-16.00.js", toSha: "x5", status: "complete", share: 1, completedAt: at(30) }),
    // 16.0.6: rolling on both endpoints, the same bytes.
    roll({ channel: "prod", group: "16.0.6", path: "excel-web-16.00.js", toSha: "x6", firstMin: 60 }),
    roll({ channel: "onecdn-prod", group: "16.0.6", path: "excel-web-16.00.js", toSha: "x6", firstMin: 62, share: 0.25, recentShare: 0.25 }),
    // 16.0.7: both endpoints, but word-web differs.
    roll({ channel: "prod", group: "16.0.7", path: "excel-web-16.00.js", toSha: "x7", firstMin: 120 }),
    roll({ channel: "prod", group: "16.0.7", path: "word-web-16.00.js", toSha: "w7", firstMin: 120 }),
    roll({ channel: "onecdn-prod", group: "16.0.7", path: "excel-web-16.00.js", toSha: "x7", firstMin: 121 }),
    roll({ channel: "onecdn-prod", group: "16.0.7", path: "word-web-16.00.js", toSha: "w7-onecdn", firstMin: 121 }),
    // 16.0.8: OneCDN only so far.
    roll({ channel: "onecdn-prod", group: "16.0.8", path: "excel-web-16.00.js", toSha: "x8", firstMin: 180, severity: "medium" }),
    // Beta 16.0.9: same host bytes on both, but the legacy office.js changed its security defaults.
    roll({ channel: "beta", group: "16.0.9", path: "excel-web-16.00.js", toSha: "b9", firstMin: 200 }),
    roll({ channel: "beta", group: "16.0.9", path: "office.js", role: "loader", toSha: "L9", firstMin: 200, severity: "high", flagsChanged: true, fromFlags: { securityDefaults: null, loadMsAjax: null }, toFlags: { securityDefaults: true, loadMsAjax: false } }),
    roll({ channel: "onecdn-beta", group: "16.0.9", path: "excel-web-16.00.js", toSha: "b9", firstMin: 201 }),
  ]);
  await fileStates.insertMany(
    ["prod", "onecdn-prod", "beta", "onecdn-beta"].flatMap((channel) => [
      { channel, region: "test", path: "excel-web-16.00.js", stableSha: "x5", stableBuild: "16.0.5" },
      { channel, region: "test", path: "office.js", stableSha: channel.startsWith("onecdn") ? "Lo5" : "L5", stableBuild: "16.0.5" },
    ]),
  );
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("releases", () => {
  it("list one row per track and build, newest first, numbers from legacy", async () => {
    const prod = await q.listReleases({ track: "prod" });
    expect(prod.map((r) => [r.channel, r.group])).toEqual([
      ["prod", "16.0.8"],
      ["prod", "16.0.7"],
      ["prod", "16.0.6"],
      ["prod", "16.0.5"],
    ]);
    const r6 = prod.find((r) => r.group === "16.0.6");
    expect(r6.share).toBe(0.5); // legacy's, not OneCDN's 25%
    expect(r6.endpoints.onecdn).toMatchObject({ channel: "onecdn-prod", status: "rolling", share: 0.25 });

    const all = await q.listReleases({});
    expect(all.filter((r) => r.group === "16.0.6")).toHaveLength(1);
    expect(all.every((r) => r.channel === "prod" || r.channel === "beta")).toBe(true);
  });

  it("know an endpoint that started on the build, and flag only real divergence", async () => {
    const byGroup = new Map((await q.listReleases({ limit: 50 })).map((r) => [r.group, r]));
    expect(byGroup.get("16.0.5").endpoints.onecdn).toEqual({ channel: "onecdn-prod", status: "stable" });
    expect(byGroup.get("16.0.5").diverged).toBe(false);
    expect(byGroup.get("16.0.6").diverged).toBe(false);
    expect(byGroup.get("16.0.7")).toMatchObject({ diverged: true, differentFiles: ["word-web-16.00.js"] });
    // OneCDN only: numbers from OneCDN, legacy not seen.
    expect(byGroup.get("16.0.8")).toMatchObject({ diverged: true, severity: "medium", endpoints: { legacy: null } });
    expect(byGroup.get("16.0.9")).toMatchObject({ diverged: true, flagsChanged: true, differentFiles: [] });
  });

  it("filter on the release, not on one endpoint", async () => {
    expect((await q.listReleases({ track: "prod", severity: "medium" })).map((r) => r.group)).toEqual(["16.0.8"]);
    expect((await q.listReleases({ track: "prod", activeOnly: true })).map((r) => r.group)).toEqual([
      "16.0.8",
      "16.0.7",
      "16.0.6",
    ]);
    const page = await q.listReleases({ track: "prod", before: at(121), limit: 10 });
    expect(page.map((r) => r.group)).toEqual(["16.0.7", "16.0.6", "16.0.5"]);
  });

  it("serve one page per track with the flags notice and no OneCDN pages", async () => {
    const r = await q.getRelease("beta", "16.0.9");
    expect(r.flags).toHaveLength(1);
    expect(r.flags[0]).toMatchObject({ endpoint: "legacy", to: { securityDefaults: true } });
    expect(r.flags[0].notice).toContain("Office.js loader on beta changed security defaults");
    expect(await q.getRelease("onecdn-prod", "16.0.6")).toBeNull();
    expect((await q.getRelease("prod", "16.0.6")).flags).toEqual([]);
  });

  it("put each release in the sitemap once, under its track", async () => {
    const pages = await q.sitemapReleases();
    const keys = pages.map((p) => `${p.channel}/${p.group}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(["beta/16.0.9", "prod/16.0.5", "prod/16.0.6", "prod/16.0.7", "prod/16.0.8"]);
  });

  it("show two cards, each with both endpoints", async () => {
    const { channels } = await q.overview();
    expect(channels.map((c) => c.channel)).toEqual(["prod", "beta"]);
    // The newest release, for a card with nothing rolling.
    expect(channels[0].latest).toMatchObject({ channel: "prod", group: "16.0.8" });
    expect(channels[0].endpoints).toMatchObject({
      legacy: { channel: "prod", build: "16.0.5" },
      onecdn: { channel: "onecdn-prod", build: "16.0.5" },
    });
  });
});
