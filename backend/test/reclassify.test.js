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
  ]));
  await apiChanges.insertMany([
    { rolloutId: ids[0], path: "Excel.Preview", kind: "removed", severity: "high" },
    { rolloutId: ids[1], path: "Excel.Preview", kind: "removed", severity: "high", apiStatus: null },
    { rolloutId: ids[1], path: "Excel.GaNew", from: "Excel.GaOld", kind: "renamed", severity: "high" },
    { rolloutId: ids[2], path: "Word.Thing", kind: "removed", severity: "low", apiStatus: "undocumented" },
    { rolloutId: ids[3], path: "Word.Desktop", kind: "removed", severity: "high", apiStatus: "ga", apiSet: "WordApiDesktop 1.3" },
    { rolloutId: ids[4], path: "Word.Desktop", kind: "removed", severity: "high", apiStatus: "ga", apiSet: "WordApiDesktop 1.3" },
  ]);
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("reclassifyStored", () => {
  it("dry run reports what would change and writes nothing", async () => {
    const { changes, lowered } = await mod.reclassifyStored(statusOf, { dryRun: true });
    expect(changes).toBe(5);
    expect(lowered.map((r) => [r.path, r.from, r.to, r.note])).toEqual([
      ["excel-web-16.00.js", "high", "low", null],
      ["word-ios-16.00.js", "high", "medium", "WordApiDesktop 1.3 is not GA on ios"],
    ]);
    expect(await apiChanges.countDocuments({ apiStatus: null })).toBe(3);
    expect((await rollouts.findOne({ _id: ids[3] })).severity).toBe("high");
  });

  it("classifies unclassified changes and lowers rollout severity", async () => {
    expect(await mod.reclassifyStored(statusOf)).toMatchObject({ changes: 5, rollouts: 2 });
    const rows = await apiChanges.find().sort({ _id: 1 }).toArray();
    expect(rows.map((c) => [c.path, c.apiStatus, c.severity])).toEqual([
      ["Excel.Preview", "preview", "low"],
      ["Excel.Preview", "preview", "low"],
      // A rename is classified by its old name, the one existing add-ins use.
      ["Excel.GaNew", "ga", "high"],
      ["Word.Thing", "undocumented", "low"],
      ["Word.Desktop", "ga", "medium"],
      ["Word.Desktop", "ga", "high"],
    ]);
    const all = await rollouts.find().sort({ _id: 1 }).toArray();
    expect(all.map((r) => r.severity)).toEqual(["low", "high", "low", "medium", "high"]);
    expect(all[3].apiDiffNote).toBe("WordApiDesktop 1.3 is not GA on ios");
  });

  it("does nothing the second time", async () => {
    expect(await mod.reclassifyStored(statusOf)).toEqual({ changes: 0, rollouts: 0, lowered: [] });
  });
});
