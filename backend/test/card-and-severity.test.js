import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { endpointProgress, latestChangeText } from "../../frontend/lib/format.js";

/**
 * A channel card names a build only where an endpoint is settled on it, a change lowered on some platforms
 * says so, and /reference finds the newest change that matters. Synthetic data on an in-memory MongoDB.
 */
let mongo;
let q;

const base = Date.now() - 6 * 3600_000;
const at = (min) => new Date(base + min * 60_000);
const roll = (o) => ({
  region: "test",
  fromSha: "old",
  severity: "low",
  apiChangeCount: 0,
  status: "rolling",
  share: 0.45,
  recentShare: 0.45,
  lastSeenAt: at(300),
  history: [0.2, 0.3].map((share, i) => ({ at: at(i * 10), share })),
  firstSeenAt: at(0),
  toBuild: o.group,
  ...o,
});
const done = (o) => roll({ status: "complete", share: 1, recentShare: 1, completedAt: at(200), ...o });
const IOS = "word-ios-16.00.js";
const WIN = "word-win32-16.01.js";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "card-test";
  process.env.REGION = "test";
  process.env.CHANNELS = "prod,onecdn-prod";
  q = await import("../src/web/queries.js");
  const { rollouts, fileStates, apiChanges } = await (await import("../src/db.js")).db();

  // 16.0.5 rolls out on both endpoints, but legacy's office.js finished first, so its stable loader is ahead.
  await rollouts.insertMany([
    ...["prod", "onecdn-prod"].map((channel) => roll({ channel, group: "16.0.5", fromBuild: "16.0.4", path: IOS, toSha: "a5" })),
    done({ channel: "prod", group: "16.0.5", fromBuild: "16.0.4", path: "office.js", toSha: "l5" }),
  ]);
  await fileStates.insertMany([
    { channel: "prod", region: "test", path: "office.js", stableSha: "l5", stableBuild: "16.0.5" },
    { channel: "onecdn-prod", region: "test", path: "office.js", stableSha: "l4", stableBuild: "16.0.4" },
  ]);

  // 16.0.4: a removal that is High on win32, and lowered to Medium on ios where its set is not production.
  const { insertedIds } = await rollouts.insertMany([
    done({
      channel: "prod",
      group: "16.0.4",
      fromBuild: "16.0.3",
      path: WIN,
      toSha: "w4",
      severity: "high",
      firstSeenAt: at(-600),
    }),
    done({
      channel: "prod",
      group: "16.0.4",
      fromBuild: "16.0.3",
      path: IOS,
      toSha: "i4",
      severity: "medium",
      apiDiffNote: "reflection incomplete; WordApiDesktop 1.3 is not GA on ios",
      firstSeenAt: at(-600),
    }),
  ]);
  const set = "WordApiDesktop 1.3";
  const row = (rolloutId, file, path, severity, gaOnPlatform) => ({
    rolloutId,
    file,
    path,
    kind: "removed",
    severity,
    apiStatus: "ga",
    apiSet: set,
    gaOnPlatform,
    before: { kind: "property" },
  });
  await apiChanges.insertMany(
    ["a", "b"].flatMap((m) => [
      row(insertedIds[0], WIN, `Word.LineFormat.${m}`, "high", true),
      row(insertedIds[1], IOS, `Word.LineFormat.${m}`, "medium", false),
    ]),
  );
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("channel card", () => {
  it("does not take the build from a stable loader that is ahead of the host files", async () => {
    const { channels } = await q.overview();
    const [prod] = channels;
    expect(prod.endpoints.legacy.build).toBe("16.0.5");
    expect(prod.endpoints.onecdn.build).toBe("16.0.4");
    expect(prod.active.map((r) => r.group)).toEqual(["16.0.5"]);
    expect(prod.build).toBe("16.0.4");
  });

  const g = (legacy, onecdn) => ({
    toBuild: "16.0.20626.15200",
    group: "16.0.20626.15200",
    fromBuilds: ["16.0.20619.15190"],
    share: 0.44,
    onecdnCrawled: true,
    endpoints: { legacy, onecdn },
  });
  const rolling = (share) => ({ status: "rolling", share });

  it("names no build while both endpoints roll", () => {
    expect(endpointProgress(g(rolling(0.44), rolling(0.51)))).toBe("legacy 44% · onecdn 51% of edges");
  });

  it("names a build only on the endpoint settled on it", () => {
    expect(endpointProgress(g({ status: "complete", share: 1 }, rolling(0.51)))).toBe(
      "legacy 16.0.20626 (complete) · onecdn rolling out, 51%",
    );
    expect(endpointProgress(g(rolling(0.2), null))).toBe("legacy rolling out, 20% · onecdn 16.0.20619 (not started)");
  });

  it("keeps one share when OneCDN is not crawled", () => {
    expect(endpointProgress({ ...g(rolling(0.44), null), onecdnCrawled: false })).toBe("44% of edges");
  });
});

describe("a change lowered on some platforms", () => {
  it("lists those files on the row and explains the file, without the diff's other notes", async () => {
    const r = await q.getRelease("prod", "16.0.4");
    expect(r.severity).toBe("high");
    const [c] = r.apiChanges;
    expect(c.severity).toBe("high");
    expect(c.lowered).toEqual([{ file: IOS, severity: "medium" }]);
    expect(r.hosts.find((h) => h.path === IOS).severityNote).toBe("WordApiDesktop 1.3 is not GA on ios");
    expect(r.hosts.find((h) => h.path === WIN).severityNote).toBeNull();
  });

  it("does the same on the API type page", async () => {
    const t = await q.getApiType("Word.LineFormat");
    expect(t.events[0].lowered).toEqual([{ file: IOS, severity: "medium" }]);
    expect(t.events[0].rows).toBeUndefined();
  });
});

describe("/reference description", () => {
  it("skips newer low-severity releases and counts the top set of changes", async () => {
    const latest = await q.latestNotableChange();
    expect(latest).toMatchObject({
      type: "Word.LineFormat",
      kind: "removed",
      count: 2,
      node: "property",
      apiSet: "WordApiDesktop 1.3",
      build: "16.0.4",
    });
  });

  it("reads as one fact", () => {
    const c = {
      type: "Word.LineFormat",
      kind: "removed",
      count: 8,
      node: "property",
      apiSet: "WordApiDesktop 1.3",
      build: "16.0.20619.15190",
      firstSeenAt: "2026-10-26T18:50:00.134Z",
    };
    expect(latestChangeText(c)).toBe("Latest: Word.LineFormat lost 8 WordApiDesktop 1.3 properties in 16.0.20619 (Oct 2026).");
    expect(latestChangeText({ ...c, kind: "renamed", count: 1, node: "function", apiSet: null })).toBe(
      "Latest: Word.LineFormat: 1 function renamed in 16.0.20619 (Oct 2026).",
    );
  });
});
