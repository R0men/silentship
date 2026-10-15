import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/** Read models against an in-memory MongoDB; env is set before config.js loads, so .env is never used. */
let mongo;
let q;
let rollouts;

const base = Date.now() - 3600_000;
const at = (min) => new Date(base + min * 60_000);
const doc = (o) => ({ region: "test", toSha: "b", fromSha: "a", severity: "low", apiChangeCount: 0, ...o });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "queries-test";
  process.env.REGION = "test";
  q = await import("../src/web/queries.js");
  ({ rollouts } = await (await import("../src/db.js")).db());
  await rollouts.insertMany([
    // A real build on prod and beta: seen in several runs.
    doc({
      channel: "prod",
      group: "16.0.2",
      path: "excel-web-16.00.js",
      toBuild: "16.0.2",
      fromBuild: "16.0.1",
      status: "rolling",
      share: 0.5,
      firstSeenAt: at(0),
      lastSeenAt: at(50),
      history: [0.25, 0.5].map((share, i) => ({ at: at(i * 10), share })),
    }),
    doc({
      channel: "beta",
      group: "16.0.2",
      path: "excel-web-16.00.js",
      toBuild: "16.0.2",
      status: "complete",
      share: 1,
      firstSeenAt: at(1),
      lastSeenAt: at(50),
      history: [],
    }),
    // One run of 404s on five of eight edges: a CDN incident, not a rollout.
    doc({
      channel: "prod",
      group: "removed-16.0.1",
      path: "onenote-winrt-16.00.js",
      toSha: null,
      toBuild: null,
      fromBuild: "16.0.1",
      severity: "high",
      status: "rolling",
      share: 0,
      firstSeenAt: at(20),
      lastSeenAt: at(20),
      history: [0.625, 0, 0].map((share, i) => ({ at: at(20 + i * 10), share })),
    }),
  ]);
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("read models", () => {
  it("hide groups that were sighted in a single run", async () => {
    const groups = await q.listGroups({ limit: 10 });
    expect(groups.map((g) => `${g.channel}/${g.group}`).sort()).toEqual(["beta/16.0.2", "prod/16.0.2"]);
    expect(await q.getGroup("prod", "removed-16.0.1")).toBeNull();
    expect((await q.getGroup("prod", "16.0.2")).hosts).toHaveLength(1);
    expect((await q.sitemapGroups()).map((g) => g.group)).not.toContain("removed-16.0.1");
  });

  it("count builds, not groups, and leave incidents out of the cards", async () => {
    const { channels, stats } = await q.overview();
    expect(stats).toEqual({ rollouts30d: 1, high30d: 0 });
    const prod = channels.find((c) => c.channel === "prod");
    expect(prod.active.map((g) => g.group)).toEqual(["16.0.2"]);
    expect(prod.lastChangeAt).toEqual(at(0));
  });
});
