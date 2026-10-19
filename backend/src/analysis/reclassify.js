import { db } from "../db.js";
import { apiStatus } from "./api-catalog.js";
import { classifyChanges } from "./classify.js";
import { SEVERITY_RANK } from "./diff.js";

/**
 * Classify stored API changes that never were (`apiStatus` missing: saved before classification existed),
 * then lower the severity of their rollouts to match. Only ever lowers: a stored severity is already
 * the raw diff's, and an incomplete reflection must never turn into High (`diffReflections`).
 * Idempotent; `start` runs it once at boot, `cli reclassify` on demand.
 */
export async function reclassifyStored(statusOf = apiStatus) {
  const { apiChanges, rollouts } = await db();
  const rows = await apiChanges.find({ apiStatus: null }).toArray();
  if (!rows.length) return { changes: 0, rollouts: 0 };

  const classified = classifyChanges(rows, statusOf);
  await apiChanges.bulkWrite(
    classified.map((c) => ({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { apiStatus: c.apiStatus, apiSet: c.apiSet, severity: c.severity } },
      },
    })),
  );

  let lowered = 0;
  const ids = [...new Map(rows.map((c) => [String(c.rolloutId), c.rolloutId])).values()];
  // A loader whose security-default flags changed is High whatever its API changes are.
  for (const r of await rollouts.find({ _id: { $in: ids }, flagsChanged: { $ne: true } }).toArray()) {
    const own = await apiChanges.find({ rolloutId: r._id }).project({ severity: 1 }).toArray();
    const max = own.reduce((m, c) => Math.max(m, SEVERITY_RANK[c.severity] ?? 0), 0);
    const next = Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === max);
    if (max < (SEVERITY_RANK[r.severity] ?? 0)) {
      await rollouts.updateOne({ _id: r._id }, { $set: { severity: next } });
      lowered++;
    }
  }
  return { changes: rows.length, rollouts: lowered };
}
