import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * The home page, its live snapshot and the RSS feed tell the same story: an active release, endpoints
 * compared only on the build both serve, and API changes counted once however many files carry them.
 * In-memory MongoDB; env is set before config.js loads, so .env is never used.
 */
let mongo;
let q;
let server;
let live;
let format;

const base = Date.now() - 6 * 3600_000;
const at = (min) => new Date(base + min * 60_000);
// Seen in two runs: a confirmed group.
const seen = (min) => [0.02, 0.03].map((share, i) => ({ at: at(min + i * 10), share }));
const roll = (o) => ({
  region: "test",
  fromSha: "old",
  fromBuild: "16.0.1",
  severity: "low",
  apiChangeCount: 0,
  status: "rolling",
  share: 0.03,
  recentShare: 0.03,
  lastSeenAt: at(300),
  history: seen(o.firstMin ?? 0),
  firstSeenAt: at(o.firstMin ?? 0),
  toBuild: o.group,
  ...o,
});
const FILES = ["excel-web-16.00.js", "word-web-16.00.js", "powerpoint-web-16.00.js", "onenote-web-16.00.js"];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "home-test";
  process.env.REGION = "test";
  process.env.CHANNELS = "prod,beta,onecdn-prod,onecdn-beta";
  q = await import("../src/web/queries.js");
  server = await import("../src/web/server.js");
  live = await import("../src/web/live.js");
  format = await import("../../frontend/lib/format.js");
  const { rollouts, fileStates, apiChanges } = await (await import("../src/db.js")).db();

  // 16.0.2 is rolling on legacy (four files); OneCDN has two of them so far: excel-web with the same bytes,
  // powerpoint-web with other bytes. word-web and onenote-web are still 16.0.1 there.
  // 16.0.1 is the previous build, complete (a removed API in excel-web makes 16.0.2 High).
  const { insertedIds } = await rollouts.insertMany([
    ...FILES.map((path, i) => roll({ channel: "prod", group: "16.0.2", path, toSha: `${path}@2`, severity: i ? "low" : "high" })),
    roll({ channel: "onecdn-prod", group: "16.0.2", path: "excel-web-16.00.js", toSha: "excel-web-16.00.js@2", firstMin: 30 }),
    roll({ channel: "onecdn-prod", group: "16.0.2", path: "powerpoint-web-16.00.js", toSha: "other", firstMin: 30 }),
  ]);
  await rollouts.insertMany(
    FILES.map((path) =>
      roll({ channel: "prod", group: "16.0.1", path, toSha: `${path}@1`, fromBuild: "16.0.0", status: "complete", share: 1, firstMin: -600, completedAt: at(-300) }),
    ),
  );
  await fileStates.insertMany(
    ["prod", "onecdn-prod"].flatMap((channel) =>
      FILES.map((path) => ({ channel, region: "test", path, stableSha: `${path}@1`, stableBuild: "16.0.1" })),
    ),
  );
  // The same two changes in every legacy file, one more in word-web only: 3 API changes in 4 files,
  // 9 rows across files.
  const legacyIds = FILES.map((_, i) => insertedIds[i]);
  const change = (rolloutId, path, kind) => ({ rolloutId, file: "x.js", path, kind, severity: "low" });
  await apiChanges.insertMany([
    ...legacyIds.flatMap((id) => [change(id, "Office.Foo.bar", "added"), change(id, "Office.Foo.baz", "added")]),
    change(legacyIds[1], "Word.Body.qux", "added"),
  ]);
  await rollouts.updateMany({ _id: { $in: legacyIds } }, { $set: { apiChangeCount: 2 } });
  await rollouts.updateOne({ _id: legacyIds[1] }, { $set: { apiChangeCount: 3 } });
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("home page", () => {
  it("shows the active release in the headline, on the card and in the list, as the RSS feed does", async () => {
    const home = await q.homeSnapshot();
    const prod = home.overview.channels.find((c) => c.channel === "prod");
    expect(prod.active.map((r) => r.group)).toEqual(["16.0.2"]);
    expect(prod.latest.group).toBe("16.0.2");
    expect(home.rollouts.map((r) => `${r.channel}/${r.group}`)).toEqual(["prod/16.0.2", "prod/16.0.1"]);

    // The list on the page and the feed are the same rows.
    const feed = await q.listReleases({ limit: 50 });
    expect(feed.map((r) => `${r.channel}/${r.group}`)).toEqual(home.rollouts.map((r) => `${r.channel}/${r.group}`));
    expect(server.rssFeed(feed, "https://example.test")).toContain("Office.js prod: build 16.0.2");
  });

  it("leads with the rolling release, not the complete one before it, and counts it as High", async () => {
    const home = await q.homeSnapshot();
    const prod = home.overview.channels.find((c) => c.channel === "prod");
    // Headline and card: the rolling build, with the complete one as "previous".
    expect(prod.active).toHaveLength(1);
    expect(prod.active[0]).toMatchObject({ group: "16.0.2", status: "rolling", severity: "high" });
    expect(prod.previous).toMatchObject({ group: "16.0.1", status: "complete" });
    expect(format.severityPhrase(prod.active[0])).toBe("high-severity API changes");
    // List and counter.
    expect(home.rollouts[0]).toMatchObject({ group: "16.0.2", status: "rolling" });
    expect(home.overview.stats).toEqual({ rollouts30d: 2, high30d: 1 });
  });

  it("serves /api/home from the same snapshot", async () => {
    const app = await server.buildServer();
    const res = await app.inject({ url: "/api/home" });
    expect(res.statusCode).toBe(200);
    expect(res.json().overview.channels[0].active[0].group).toBe("16.0.2");
    await app.close();
  });
});

describe("live snapshot", () => {
  it("never ends on a build started before the newest data", async () => {
    let key = "run1:running";
    let data = "old";
    let release;
    // The first build is slow and reads the data as it was before the crawl wrote it.
    const build = vi.fn(async () => {
      const seenData = data;
      if (build.mock.calls.length === 1) await new Promise((r) => (release = r));
      return { overview: seenData, rollouts: [], at: new Date().toISOString() };
    });
    const feed = live.createLiveFeed({ build, runKey: async () => key });
    const first = feed.check();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    // The crawl finishes while the slow build runs; the next poll must not race it.
    key = "run1:ok";
    data = "new";
    const second = feed.check();
    expect(second).toBe(first);
    release();
    await first;
    expect(feed.snapshot.overview).toBe("old");
    await feed.check();
    expect(feed.snapshot.overview).toBe("new");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("retries a failed build and refreshes an old snapshot without a new run", async () => {
    let t = 0;
    let fail = true;
    let data = "a";
    const build = vi.fn(async () => {
      if (fail) throw new Error("db down");
      return { overview: data, rollouts: [], at: String(t) };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const feed = live.createLiveFeed({ build, runKey: async () => "run1:ok", maxAgeMs: 60_000, now: () => t });
    await feed.check();
    expect(feed.snapshot).toBeNull();
    fail = false;
    await feed.check(); // same run key, but the failed build did not count
    expect(feed.snapshot.overview).toBe("a");
    data = "b";
    t = 30_000;
    await feed.check();
    expect(feed.snapshot.overview).toBe("a"); // fresh enough
    t = 61_000;
    await feed.check();
    expect(feed.snapshot.overview).toBe("b");
    error.mockRestore();
  });
});

describe("endpoints", () => {
  it("compare only files both endpoints serve on the build", async () => {
    const [r] = await q.listReleases({ track: "prod" });
    expect(r.differentFiles).toEqual(["powerpoint-web-16.00.js"]);
    expect(r.notYetOn).toEqual({ legacy: [], onecdn: ["onenote-web-16.00.js", "word-web-16.00.js"] });
    expect(r.diverged).toBe(true);
    expect(r.files).toBe(4);
  });

  it("count a file still on the old build as not yet there, not as a difference", async () => {
    const { rollouts } = await (await import("../src/db.js")).db();
    await rollouts.updateOne({ channel: "onecdn-prod", path: "powerpoint-web-16.00.js" }, { $set: { toSha: "powerpoint-web-16.00.js@2" } });
    const [r] = await q.listReleases({ track: "prod" });
    expect(r.differentFiles).toEqual([]);
    expect(r.diverged).toBe(false);
    expect(r.notYetOn.onecdn).toHaveLength(2);
    await rollouts.updateOne({ channel: "onecdn-prod", path: "powerpoint-web-16.00.js" }, { $set: { toSha: "other" } });
  });
});

describe("API change counts", () => {
  it("lead with unique changes everywhere, files second", async () => {
    const [group] = await q.listGroups({ channel: "prod", group: "16.0.2", limit: 1 });
    expect(group).toMatchObject({ uniqueApiChanges: 3, apiChangeFiles: 4, apiChangeCount: 9 });

    const [release] = await q.listReleases({ track: "prod" });
    expect(release).toMatchObject({ uniqueApiChanges: 3, apiChangeFiles: 4 });
    expect(release.endpoints.legacy).toMatchObject({ uniqueApiChanges: 3, apiChangeFiles: 4 });
    expect(release.endpoints.onecdn).toMatchObject({ uniqueApiChanges: 0, apiChangeFiles: 0 });

    // The rollout page lists exactly that many changes.
    const page = await q.getRelease("prod", "16.0.2");
    expect(page.apiChanges).toHaveLength(page.uniqueApiChanges);

    expect(server.apiChangesLine(release)).toBe("3 API changes in 4 files");
    expect(server.apiChangesLine({ uniqueApiChanges: 1, apiChangeFiles: 1 })).toBe("1 API change in 1 file");
    const rss = server.rssFeed([release], "https://example.test");
    expect(rss).toContain("3 API changes in 4 files. 4 files, on ~3% of sampled edges.");
    expect(rss).not.toContain("9 API");
  });
});
