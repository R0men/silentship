import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/** Read models against an in-memory MongoDB; env is set before config.js loads, so .env is never used. */
let mongo;
let q;
let rollouts;
let apiChanges;

const base = Date.now() - 3600_000;
const at = (min) => new Date(base + min * 60_000);
const doc = (o) => ({ region: "test", toSha: "b", fromSha: "a", severity: "low", apiChangeCount: 0, ...o });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "queries-test";
  process.env.REGION = "test";
  q = await import("../src/web/queries.js");
  ({ rollouts, apiChanges } = await (await import("../src/db.js")).db());
  const { insertedIds: ids } = await rollouts.insertMany([
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
    // A file of the beta build that was pulled back.
    doc({
      channel: "beta",
      group: "16.0.2",
      path: "word-web-16.00.js",
      toBuild: "16.0.2",
      status: "abandoned",
      share: 0,
      firstSeenAt: at(2),
      lastSeenAt: at(5),
      history: [],
    }),
  ]);
  const change = (i, path, kind, o = {}) => ({ rolloutId: ids[i], file: "x.js", path, kind, severity: "low", ...o });
  await apiChanges.insertMany([
    change(0, "Excel.Range.getCell", "removed", { severity: "high" }),
    change(0, "Excel.Copilot.allowedUrls", "added"),
    change(1, "Excel.Range.getCell", "removed", { severity: "high" }),
    change(1, "Excel.SensitivityLabelUpdateResult", "renamed", { from: "Excel.SensitivityLabelUpdateStatus" }),
    change(2, "Excel.Ghost", "removed", { severity: "high" }),
    change(3, "Word.Body.insertWidget", "removed", { severity: "high" }),
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

describe("API type pages", () => {
  it("map a path to its type", () => {
    expect(q.apiTypeOf("Excel.SensitivityLabelAbacAttribute")).toBe("Excel.SensitivityLabelAbacAttribute");
    expect(q.apiTypeOf("Excel.Copilot.allowedUrls")).toBe("Excel.Copilot");
    expect(q.apiTypeOf("Office.MailboxEnums.ItemType")).toBe("Office.MailboxEnums.ItemType");
    expect(q.apiTypeOf("Office.context.document.getFileAsync")).toBe("Office.context.document");
    // No PascalCase after the root: the parent object, never the whole Office namespace.
    expect(q.apiTypeOf("Office.context.ui.displayDialogAsync")).toBe("Office.context.ui");
    expect(q.apiTypeOf("Office.context.ui.messageParent")).toBe("Office.context.ui");
    expect(q.apiTypeOf("Excel.run")).toBe("Excel.run");
    expect(q.apiTypeOf("Office")).toBe("Office");
  });

  it("show a type's history from confirmed rollouts only", async () => {
    const t = await q.getApiType("Excel.Range");
    expect(t.type).toBe("Excel.Range");
    expect(t.docs).toEqual({
      status: "ga",
      apiSet: "ExcelApi 1.1",
      url: "https://learn.microsoft.com/en-us/javascript/api/excel/excel.range",
    });
    expect(t.events.map((e) => `${e.channel} ${e.path} ${e.kind}`).sort()).toEqual([
      "beta Excel.Range.getCell removed",
      "prod Excel.Range.getCell removed",
    ]);
    expect(t.events.find((e) => e.channel === "prod")).toMatchObject({ status: "rolling", files: ["excel-web-16.00.js"] });
    expect(t.related.map((r) => r.type)).toEqual(
      expect.arrayContaining(["Excel.Copilot", "Excel.SensitivityLabelUpdateResult", "Word.Body"]),
    );
    expect(t.related.map((r) => r.type)).not.toContain("Excel.Ghost");
    expect(await q.getApiType("Excel.Ghost")).toBeNull();
    expect(await q.getApiType("Excel.Nope")).toBeNull();
    expect(await q.getApiType("Excel.(")).toBeNull();
  });

  it("find the canonical spelling, both names of a rename and pulled-back changes", async () => {
    expect((await q.getApiType("excel.range")).type).toBe("Excel.Range");
    const old = await q.getApiType("Excel.SensitivityLabelUpdateStatus");
    expect(old.events[0]).toMatchObject({ path: "Excel.SensitivityLabelUpdateResult", kind: "renamed" });
    const pulled = await q.getApiType("Word.Body");
    expect(pulled.events[0]).toMatchObject({ status: "abandoned", files: [], pulledFiles: ["word-web-16.00.js"] });
  });

  it("list every changed type for the hub and the sitemap", async () => {
    const types = await q.listApiTypes();
    expect(types.map((t) => t.type).sort()).toEqual([
      "Excel.Copilot",
      "Excel.Range",
      "Excel.SensitivityLabelUpdateResult",
      "Excel.SensitivityLabelUpdateStatus",
      "Word.Body",
    ]);
    expect(types.find((t) => t.type === "Excel.Range")).toMatchObject({
      namespace: "Excel",
      channels: ["prod", "beta"],
      kinds: ["removed"],
      severity: "high",
    });
  });
});
