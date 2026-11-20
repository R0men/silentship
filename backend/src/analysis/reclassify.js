import { db } from "../db.js";
import { apiStatus } from "./api-catalog.js";
import { classifyChanges, isSideEffect, platformSeverity } from "./classify.js";
import { SEVERITY_RANK } from "./diff.js";

const nameOf = (rank) => Object.keys(SEVERITY_RANK).find((k) => SEVERITY_RANK[k] === rank);

/**
 * Bring stored API changes up to the current rules, then lower the severity of their rollouts to match:
 *  - changes saved before classification existed (`apiStatus` missing) get their status and set;
 *  - GA changes saved before platforms were checked (`gaOnPlatform` missing) drop one level when their
 *    requirement set is not production on the rollout's `hostPlatform`;
 *  - a generated `set`/`toJSON` above Low whose type gained, lost or renamed a member in the same rollout becomes Low with
 *    `follows` (a side effect of the new member, `markSideEffects` in classify.js).
 *  - a body change tagged undocumented whose API is documented under its typed path (`typedPath` in
 *    api-catalog.js) becomes GA and Medium (or Low where its set is not production), and its rollout rises to
 *    match. The only case that raises: a body change is never High, so an incomplete reflection still can't be.
 * Otherwise it only lowers: a stored severity is already the raw diff's, and an incomplete reflection must never
 * turn into High (`diffReflections`). Idempotent; `start` runs it once at boot, `cli reclassify` on demand.
 * `dryRun` writes nothing and returns what it would change (`lowered`), for review before production.
 */
export async function reclassifyStored(statusOf = apiStatus, { dryRun = false } = {}) {
  const { apiChanges, rollouts } = await db();
  const rows = await apiChanges
    .find({ $or: [{ apiStatus: null }, { apiStatus: "ga", gaOnPlatform: { $exists: false } }] })
    .toArray();
  // Generated set/toJSON saved above Low before side effects were recognised (classify.js, markSideEffects).
  const generated = await apiChanges
    .find({ kind: "bodyChanged", severity: { $ne: "low" }, follows: null, path: { $regex: /\.(set|toJSON)$/ } })
    .toArray();
  const sideEffects = new Map();
  for (const c of generated) {
    const siblings = await apiChanges.find({ rolloutId: c.rolloutId, kind: { $in: ["added", "removed", "renamed"] } }).toArray();
    const follows = isSideEffect(c, siblings);
    if (follows.length) sideEffects.set(String(c._id), { ...c, severity: "low", follows });
  }
  // Body changes of documented APIs reached through an object (Office.ribbon.requestUpdate), tagged undocumented
  // before the catalogue followed `typedPath`. A body change is at most Medium, so this never makes High.
  const misfiled = (await apiChanges.find({ kind: "bodyChanged", apiStatus: "undocumented" }).toArray()).filter(
    (c) => !sideEffects.has(String(c._id)) && statusOf(c.path).status === "ga",
  );
  if (!rows.length && !sideEffects.size && !misfiled.length) return { changes: 0, rollouts: 0, lowered: [], raised: [] };

  const ids = [...new Map([...rows, ...sideEffects.values(), ...misfiled].map((c) => [String(c.rolloutId), c.rolloutId])).values()];
  const owners = new Map(
    (await rollouts.find({ _id: { $in: ids } }).toArray()).map((r) => [String(r._id), r]),
  );
  const platformOf = (c) => owners.get(String(c.rolloutId))?.hostPlatform ?? null;

  const classified = rows.map((c) => {
    if (c.apiStatus == null) return classifyChanges([c], statusOf, platformOf(c))[0];
    return { ...c, ...platformSeverity(c, platformOf(c)) };
  });
  // A row that is both unclassified and a side effect gets its status and set, then Low with `follows`.
  const marked = new Map(classified.map((c) => [String(c._id), c]));
  for (const [id, c] of sideEffects) {
    const base = marked.get(id) ?? c;
    marked.set(id, { ...base, severity: "low", follows: c.follows });
  }
  for (const c of misfiled) {
    const { apiSet } = statusOf(c.path);
    marked.set(String(c._id), { ...c, apiStatus: "ga", apiSet: apiSet ?? null, ...platformSeverity({ severity: "medium", apiSet }, platformOf(c)) });
  }
  const raisedIds = new Set(misfiled.map((c) => String(c.rolloutId)));
  const updated = [...marked.values()];
  const byId = new Map(updated.map((c) => [String(c._id), c]));
  if (!dryRun) {
    await apiChanges.bulkWrite(
      updated.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              apiStatus: c.apiStatus,
              apiSet: c.apiSet,
              severity: c.severity,
              gaOnPlatform: c.gaOnPlatform ?? null,
              ...(c.follows && { follows: c.follows }),
            },
          },
        },
      })),
    );
  }

  const lowered = [];
  const raised = [];
  for (const r of owners.values()) {
    // A loader whose security-default flags changed is High whatever its API changes are.
    if (r.flagsChanged === true) continue;
    const own = (await apiChanges.find({ rolloutId: r._id }).toArray()).map((c) => byId.get(String(c._id)) ?? c);
    const max = own.reduce((m, c) => Math.max(m, SEVERITY_RANK[c.severity] ?? 0), 0);
    if (raisedIds.has(String(r._id)) && max > (SEVERITY_RANK[r.severity] ?? 0)) {
      raised.push({ id: r._id, channel: r.channel, path: r.path, toBuild: r.toBuild, from: r.severity, to: nameOf(max) });
      if (!dryRun) await rollouts.updateOne({ _id: r._id }, { $set: { severity: nameOf(max) } });
      continue;
    }
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
  return { changes: updated.length, rollouts: lowered.length + raised.length, lowered, raised };
}
