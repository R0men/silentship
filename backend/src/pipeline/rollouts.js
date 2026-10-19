import { compareBuilds } from "../crawler/build.js";

/**
 * Rollout tracking for one file, as pure functions (no I/O) so every rule is unit-testable.
 *
 * Each run takes N samples of a file on fresh connections. Samples are conditional on the stable
 * version's Last-Modified, so edges still serving it answer 304 and cost nothing; only a different
 * version comes back with a body. The share of samples per version is what we report: "16.0.20606 is
 * on 25% of edges", rather than a binary "changed".
 *
 * A file's versions are identified by sha256; `null` sha means "file absent" (404), so additions and
 * removals are rollouts like any other.
 */

/** Consecutive runs at 100% before a rollout counts as complete (and becomes the new stable version). */
export const COMPLETE_RUNS = 3;
/** A rollout not seen on any sample for this long is considered pulled back. */
export const ABANDON_MS = 24 * 3600_000;
/**
 * Runs a version must be sighted in before its group counts as a rollout (alerts, site, RSS, sitemap).
 * A single run of 404s or of a new body is a short CDN incident, not a release (2026-10-15: five of eight
 * edges returned 404 for onenote-winrt-16.00.js in one run, then served it again). Such data is kept:
 * see docs/tasks/PLAN.md.
 */
export const CONFIRM_RUNS = 2;
/** How many share points to keep per rollout for the history chart. */
export const HISTORY_LIMIT = 300;
/** Runs averaged for the displayed share: with ~8 samples a single run swings by 12.5% steps. */
export const SMOOTHING_RUNS = 6;

/** Mean share over the last SMOOTHING_RUNS runs, including this one. */
export function smoothedShare(history, share) {
  const recent = [...(history ?? []).slice(-(SMOOTHING_RUNS - 1)).map((h) => h.share), share];
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

const ABSENT = "absent";
const keyOf = (sha) => sha ?? ABSENT;
const lmTime = (lm) => (lm ? Date.parse(lm) || 0 : 0);

/**
 * Collapse sample responses into versions.
 * `results` items: { notModified, httpStatus, sha256, body, build, lastModified, edgeIp } or { error }.
 * A 304 means "not newer than the stable version" and is attributed to it.
 */
export function tallySamples(results, state) {
  const variants = new Map();
  let samples = 0;
  let errors = 0;
  const bump = (sha, fields) => {
    const key = keyOf(sha);
    const v = variants.get(key) ?? { sha, build: null, lastModified: null, count: 0, body: null, edges: new Set() };
    v.count++;
    if (fields.build) v.build = fields.build;
    if (lmTime(fields.lastModified) > lmTime(v.lastModified)) v.lastModified = fields.lastModified;
    if (fields.body && !v.body) v.body = fields.body;
    if (fields.edgeIp) v.edges.add(fields.edgeIp);
    variants.set(key, v);
  };

  for (const r of results) {
    if (r.error) {
      errors++;
      continue;
    }
    samples++;
    if (r.notModified) {
      bump(state?.stableSha ?? null, { build: state?.stableBuild, edgeIp: r.edgeIp });
    } else if (r.httpStatus >= 200 && r.httpStatus < 300) {
      bump(r.sha256, r);
    } else if (r.httpStatus === 404 || r.httpStatus === 410) {
      bump(null, { edgeIp: r.edgeIp });
    } else {
      // 5xx or anything odd says nothing about versions.
      samples--;
      errors++;
    }
  }
  return { samples, errors, variants };
}

/** Is `v` a newer version than the stable one? Build stamps decide; Last-Modified breaks ties. */
export function isNewer(v, stable) {
  if (v.sha === null || stable.sha === null) return true; // additions and removals always count
  if (v.build && stable.build) {
    const c = compareBuilds(v.build, stable.build);
    if (c !== 0) return c > 0;
  }
  return lmTime(v.lastModified) > lmTime(stable.lastModified);
}

function pickBaseline(variants) {
  const present = [...variants.values()].filter((v) => v.sha !== null);
  if (present.length === 0) return variants.get(ABSENT) ?? null;
  // The oldest version present is the stable one; anything newer is already rolling out.
  return present.reduce((a, b) => (isNewer(a, b) ? b : a));
}

/** The newest version present: a new channel's baseline, so edges still on older versions count as stale. */
function pickNewest(variants) {
  const present = [...variants.values()].filter((v) => v.sha !== null);
  if (present.length === 0) return variants.get(ABSENT) ?? null;
  return present.reduce((a, b) => (isNewer(b, a) ? b : a));
}

/**
 * Decide what one run's samples mean for a file.
 * @param state     fileState doc or null on first sight: { stableSha, stableBuild, stableLM, retiredShas }
 * @param tally     result of tallySamples
 * @param rollouts  this file's rollouts that are still `rolling`
 * @param bootstrap the channel's first run (no file has a stable version yet): record what the CDN serves
 *                  as the baseline and create no rollouts, so a new channel starts without phantom releases
 * @returns {{ state, creates, updates, stale }}
 */
export function planFile({ state, tally, rollouts, now, bootstrap = false }) {
  const { samples, variants } = tally;
  const creates = [];
  const updates = [];
  let stale = 0;
  if (samples === 0) return { state, creates, updates, stale };

  let next;
  if (!state) {
    const base = bootstrap ? pickNewest(variants) : pickBaseline(variants);
    next = {
      stableSha: base?.sha ?? null,
      stableBuild: base?.build ?? null,
      stableLM: base?.lastModified ?? null,
      retiredShas: [],
    };
  } else {
    next = { ...state, retiredShas: [...(state.retiredShas ?? [])] };
  }

  // Keep the conditional-request floor at the latest Last-Modified any edge reports for stable content.
  const stableVariant = variants.get(keyOf(next.stableSha));
  if (stableVariant && lmTime(stableVariant.lastModified) > lmTime(next.stableLM)) {
    next.stableLM = stableVariant.lastModified;
  }

  if (bootstrap) {
    stale = samples - (stableVariant?.count ?? 0);
    return { state: next, creates, updates, stale };
  }

  const stableRef = { sha: next.stableSha, build: next.stableBuild, lastModified: next.stableLM };
  const active = new Map(rollouts.map((r) => [keyOf(r.toSha), r]));

  for (const [key, v] of variants) {
    if (key === keyOf(next.stableSha)) continue;
    const share = v.count / samples;
    const existing = active.get(key);
    if (existing) {
      updates.push(advance(existing, share, samples, now));
      active.delete(key);
    } else if (v.sha !== null && next.retiredShas.includes(v.sha)) {
      stale += v.count;
    } else if (!isNewer(v, stableRef)) {
      stale += v.count; // an edge that never got the current version
    } else {
      creates.push({
        fromSha: next.stableSha,
        fromBuild: next.stableBuild,
        toSha: v.sha,
        toBuild: v.build,
        toLastModified: v.lastModified,
        share,
        samples,
        body: v.body,
        edges: [...v.edges],
      });
    }
  }
  // Rollouts that no sample hit this run.
  for (const r of active.values()) updates.push(advance(r, 0, samples, now));

  // A completed rollout becomes the new stable version.
  const done = updates.filter((u) => u.status === "complete").sort((a, b) => (isNewer(a.ref, b.ref) ? -1 : 1))[0];
  if (done) {
    if (next.stableSha !== null && !next.retiredShas.includes(next.stableSha)) next.retiredShas.push(next.stableSha);
    next.retiredShas = next.retiredShas.slice(-20);
    next.stableSha = done.ref.sha;
    next.stableBuild = done.ref.build;
    next.stableLM = variants.get(keyOf(done.ref.sha))?.lastModified ?? done.ref.lastModified;
  }

  return { state: next, creates, updates: updates.map(({ ref, ...u }) => u), stale };
}

function advance(rollout, share, samples, now) {
  const fullRuns = share >= 1 ? (rollout.fullRuns ?? 0) + 1 : 0;
  const zeroSince = share > 0 ? null : (rollout.zeroSince ?? now);
  let status = "rolling";
  if (fullRuns >= COMPLETE_RUNS) status = "complete";
  else if (zeroSince && now - zeroSince >= ABANDON_MS) status = "abandoned";
  return {
    id: rollout._id,
    share,
    recentShare: smoothedShare(rollout.history, share),
    samples,
    fullRuns,
    zeroSince,
    status,
    peakShare: Math.max(rollout.peakShare ?? 0, share),
    lastSeenAt: share > 0 ? now : rollout.lastSeenAt,
    completedAt: status === "complete" ? now : null,
    ref: { sha: rollout.toSha, build: rollout.toBuild, lastModified: rollout.toLastModified },
  };
}
