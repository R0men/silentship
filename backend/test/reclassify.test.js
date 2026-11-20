import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/** Stored API changes without a status get classified; rollout severity only goes down. */
let mongo;
let mod;
let rollouts;
let apiChanges;
let ids;

const STATUS = {
  "Excel.Preview": { status: "preview", apiSet: "ExcelApi BETA (PREVIEW ONLY)" },
  "Excel.GaOld": { status: "ga", apiSet: "ExcelApi 1.4" },
  "Word.Desktop": { status: "ga", apiSet: "WordApiDesktop 1.3" },
  // Documented as Office.Ribbon.requestUpdate; apiStatus maps the runtime path (typedPath).
  "Office.ribbon.requestUpdate": { status: "ga", apiSet: "RibbonApi 1.1" },
};
const statusOf = (path) => STATUS[path] ?? { status: "undocumented", apiSet: null };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "reclassify-test";
  mod = await import("../src/analysis/reclassify.js");
  ({ rollouts, apiChanges } = await (await import("../src/db.js")).db());
  ({ insertedIds: ids } = await rollouts.insertMany([
    { path: "excel-web-16.00.js", severity: "high" }, // only a preview removal
    { path: "excel-win32-16.01.js", severity: "high" }, // a GA rename too
    { path: "word-web-16.00.js", severity: "low" }, // already classified
    // GA changes classified before platforms were checked: a desktop-only set on iOS and on Windows.
    { path: "word-ios-16.00.js", hostPlatform: "ios", severity: "high", toBuild: "16.0.20619.15190" },
    { path: "word-win32-16.01.js", hostPlatform: "win32", severity: "high", toBuild: "16.0.20619.15190" },
    // 16.0.20710: set/toJSON Medium only because the type gained allowTextToOverflow; and a set in a type
    // that gained nothing, which stays Medium.
    { path: "excel-web-16.00.js", hostPlatform: "web", severity: "medium", toBuild: "16.0.20710.15050" },
    { path: "excel-mac-16.00.js", hostPlatform: "mac", severity: "medium", toBuild: "16.0.20710.15050" },
    // Office.ribbon.requestUpdate saved as undocumented: rises to Medium.
    { path: "outlook-web-16.01.js", hostPlatform: "web", severity: "low", toBuild: "16.0.20710.15050" },
  ]));
  await apiChanges.insertMany([
    { rolloutId: ids[0], path: "Excel.Preview", kind: "removed", severity: "high" },
    { rolloutId: ids[1], path: "Excel.Preview", kind: "removed", severity: "high", apiStatus: null },
    { rolloutId: ids[1], path: "Excel.GaNew", from: "Excel.GaOld", kind: "renamed", severity: "high" },
    { rolloutId: ids[2], path: "Word.Thing", kind: "removed", severity: "low", apiStatus: "undocumented" },
    { rolloutId: ids[3], path: "Word.Desktop", kind: "removed", severity: "high", apiStatus: "ga", apiSet: "WordApiDesktop 1.3" },
    { rolloutId: ids[4], path: "Word.Desktop", kind: "removed", severity: "high", apiStatus: "ga", apiSet: "WordApiDesktop 1.3" },
    ...["set", "toJSON"].map((m) => ({
      rolloutId: ids[5], path: `Excel.ChartDataLabels.${m}`, kind: "bodyChanged", severity: "medium",
      apiStatus: "ga", apiSet: "ExcelApi 1.1", gaOnPlatform: true, follows: null,
    })),
    { rolloutId: ids[5], path: "Excel.ChartDataLabels.allowTextToOverflow", kind: "added", severity: "low", apiStatus: "undocumented", gaOnPlatform: null },
    { rolloutId: ids[6], path: "Excel.Range.set", kind: "bodyChanged", severity: "medium", apiStatus: "ga", apiSet: "ExcelApi 1.1", gaOnPlatform: true },
    // The new member is in another rollout: no reason to lower this one.
    { rolloutId: ids[6], path: "Excel.Chart.newThing", kind: "added", severity: "low", apiStatus: "undocumented", gaOnPlatform: null },
    { rolloutId: ids[7], path: "Office.ribbon.requestUpdate", kind: "bodyChanged", severity: "low", apiStatus: "undocumented", gaOnPlatform: null },
    // Undocumented for real: stays.
    { rolloutId: ids[7], path: "OfficeCore.DimeApi.launch", kind: "bodyChanged", severity: "low", apiStatus: "undocumented", gaOnPlatform: null },
  ]);
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("reclassifyStored", () => {
  it("dry run reports what would change and writes nothing", async () => {
    const { changes, lowered, raised } = await mod.reclassifyStored(statusOf, { dryRun: true });
    expect(changes).toBe(8);
    expect(raised.map((r) => [r.path, r.from, r.to])).toEqual([["outlook-web-16.01.js", "low", "medium"]]);
    expect(lowered.map((r) => [r.path, r.from, r.to, r.note])).toEqual([
      ["excel-web-16.00.js", "high", "low", null],
      ["word-ios-16.00.js", "high", "medium", "WordApiDesktop 1.3 is not GA on ios"],
      ["excel-web-16.00.js", "medium", "low", null],
    ]);
    expect(await apiChanges.countDocuments({ apiStatus: null })).toBe(3);
    expect((await rollouts.findOne({ _id: ids[3] })).severity).toBe("high");
  });

  it("classifies unclassified changes and lowers rollout severity", async () => {
    expect(await mod.reclassifyStored(statusOf)).toMatchObject({ changes: 8, rollouts: 4 });
    const rows = await apiChanges.find().sort({ _id: 1 }).toArray();
    expect(rows.map((c) => [c.path, c.apiStatus, c.severity])).toEqual([
      ["Excel.Preview", "preview", "low"],
      ["Excel.Preview", "preview", "low"],
      // A rename is classified by its old name, the one existing add-ins use.
      ["Excel.GaNew", "ga", "high"],
      ["Word.Thing", "undocumented", "low"],
      ["Word.Desktop", "ga", "medium"],
      ["Word.Desktop", "ga", "high"],
      ["Excel.ChartDataLabels.set", "ga", "low"],
      ["Excel.ChartDataLabels.toJSON", "ga", "low"],
      ["Excel.ChartDataLabels.allowTextToOverflow", "undocumented", "low"],
      ["Excel.Range.set", "ga", "medium"],
      ["Excel.Chart.newThing", "undocumented", "low"],
      ["Office.ribbon.requestUpdate", "ga", "medium"],
      ["OfficeCore.DimeApi.launch", "undocumented", "low"],
    ]);
    expect(rows[11].apiSet).toBe("RibbonApi 1.1");
    expect(rows[6].follows).toEqual(["Excel.ChartDataLabels.allowTextToOverflow"]);
    const all = await rollouts.find().sort({ _id: 1 }).toArray();
    expect(all.map((r) => r.severity)).toEqual(["low", "high", "low", "medium", "high", "low", "medium", "medium"]);
    expect(all[3].apiDiffNote).toBe("WordApiDesktop 1.3 is not GA on ios");
  });

  it("does nothing the second time", async () => {
    expect(await mod.reclassifyStored(statusOf)).toEqual({ changes: 0, rollouts: 0, lowered: [], raised: [] });
  });
});
