import { db } from "../db.js";
import { apiStatus } from "./api-catalog.js";
import { classifyChanges, platformSeverity } from "./classify.js";
import { SEVERITY_RANK } from "./diff.js";

const nameOf = (rank) => Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === rank);

/**
 * Bring stored API changes up to the current rules, then lower the severity of their rollouts to match:
 *  - changes saved before classification existed (`apiStatus` missing) get their status and set;
 *  - GA changes saved before platforms were checked (`gaOnPlatform` missing) drop one level when their
 *    requirement set is not production on the rollout's `hostPlatform`.
 * Only ever lowers: a stored severity is already the raw diff's, and an incomplete reflection must never
 * turn into High (`diffReflections`). Idempotent; `start` runs it once at boot, `cli reclassify` on demand.
 * `dryRun` writes nothing and returns what it would change (`lowered`), for review before production.
 */
export async function reclassifyStored(statusOf = apiStatus, { dryRun = false } = {}) {
  const { apiChanges, rollouts } = await db();
  const rows = await apiChanges
    .find({ $or: [{ apiStatus: null }, { apiStatus: "ga", gaOnPlatform: { $exists: false } }] })
    .toArray();
  if (!rows.length) return { changes: 0, rollouts: 0, lowered: [] };

  const ids = [...new Map(rows.map((c) => [String(c.rolloutId), c.rolloutId])).values()];
  const owners = new Map(
    (await rollouts.find({ _id: { $in: ids } }).toArray()).map((r) => [String(r._id), r]),
  );
  const platformOf = (c) => owners.get(String(c.rolloutId))?.hostPlatform ?? null;

  const updated = rows.map((c) => {
    if (c.apiStatus == null) return classifyChanges([c], statusOf, platformOf(c))[0];
    return { ...c, ...platformSeverity(c, platformOf(c)) };
  });
  const byId = new Map(updated.map((c) => [String(c._id), c]));
  if (!dryRun) {
    await apiChanges.bulkWrite(
      updated.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: { apiStatus: c.apiStatus, apiSet: c.apiSet, severity: c.severity, gaOnPlatform: c.gaOnPlatform },
          },
        },
      })),
    );
  }

  const lowered = [];
  for (const r of owners.values()) {
    // A loader whose security-default flags changed is High whatever its API changes are.
    if (r.flagsChanged === true) continue;
    const own = (await apiChanges.find({ rolloutId: r._id }).toArray()).map((c) => byId.get(String(c._id)) ?? c);
    const max = own.reduce((m, c) => Math.max(m, SEVERITY_RANK[c.severity] ?? 0), 0);
    if (max >= (SEVERITY_RANK[r.severity] ?? 0)) continue;
    const notes = [...new Set(own.map((c) => c.platformNote).filter(Boolean))];
    const note = [r.apiDiffNote, ...notes.filter((n) => !r.apiDiffNote?.includes(n))].filter(Boolean).join("; ");
    lowered.push({
      id: r._id,
      channel: r.channel,
      path: r.path,
      toBuild: r.toBuild,
      from: r.severity,
      to: nameOf(max),
      note: note || null,
    });
    if (!dryRun) await rollouts.updateOne({ _id: r._id }, { $set: { severity: nameOf(max), apiDiffNote: note || null } });
  }
  return { changes: rows.length, rollouts: lowered.length, lowered };
}
