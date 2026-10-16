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
  ]));
  await apiChanges.insertMany([
    { rolloutId: ids[0], path: "Excel.Preview", kind: "removed", severity: "high" },
    { rolloutId: ids[1], path: "Excel.Preview", kind: "removed", severity: "high", apiStatus: null },
    { rolloutId: ids[1], path: "Excel.GaNew", from: "Excel.GaOld", kind: "renamed", severity: "high" },
    { rolloutId: ids[2], path: "Word.Thing", kind: "removed", severity: "low", apiStatus: "undocumented" },
  ]);
});

afterAll(async () => {
  await (await import("../src/db.js")).closeDb();
  await mongo?.stop();
});

describe("reclassifyStored", () => {
  it("classifies unclassified changes and lowers rollout severity", async () => {
    expect(await mod.reclassifyStored(statusOf)).toEqual({ changes: 3, rollouts: 1 });
    const rows = await apiChanges.find().sort({ _id: 1 }).toArray();
    expect(rows.map((c) => [c.path, c.apiStatus, c.severity])).toEqual([
      ["Excel.Preview", "preview", "low"],
      ["Excel.Preview", "preview", "low"],
      // A rename is classified by its old name, the one existing add-ins use.
      ["Excel.GaNew", "ga", "high"],
      ["Word.Thing", "undocumented", "low"],
    ]);
    const sev = (await rollouts.find().sort({ _id: 1 }).toArray()).map((r) => r.severity);
    expect(sev).toEqual(["low", "high", "low"]);
  });

  it("does nothing the second time", async () => {
    expect(await mod.reclassifyStored(statusOf)).toEqual({ changes: 0, rollouts: 0 });
  });
});
