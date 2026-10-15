import { config } from "../config.js";
import { db } from "../db.js";
import { SEVERITY_RANK } from "../analysis/diff.js";
import { LOADER_PATH } from "../crawler/manifest.js";

/**
 * Read models for the site. Storage is one `rollouts` doc per file; the site shows one entry per
 * Microsoft build ("group"): the same new build reaching excel-web, word-win32, … together.
 */

const SEVERITY_NAME = ["low", "medium", "high"];
const sevRank = {
  $switch: {
    branches: [
      { case: { $eq: ["$severity", "high"] }, then: 2 },
      { case: { $eq: ["$severity", "medium"] }, then: 1 },
    ],
    default: 0,
  },
};
const countStatus = (status) => ({ $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] } });

function groupStatus(g) {
  if (g.rolling > 0) return "rolling";
  if (g.complete > 0) return "complete";
  return "abandoned";
}

/**
 * The one definition of a rollout group's numbers. Every view (headline, channel card, list, detail page,
 * live updates, RSS, alerts) gets them from here, so the same rollout never shows two different figures.
 *  - files: files still part of the rollout (rolling or complete); pulled-back files are counted separately;
 *  - share: mean over those files of the smoothed per-file share, a completed file counting as 100%.
 */
function summarize(g) {
  return {
    channel: g._id.channel,
    group: g._id.group,
    toBuild: g.toBuild,
    fromBuilds: g.fromBuilds.filter(Boolean).sort(),
    removal: g.removal === 1,
    files: g.files,
    abandonedFiles: g.abandoned,
    share: g.share ?? 0,
    minShare: g.minShare,
    status: groupStatus(g),
    severity: SEVERITY_NAME[g.sevRank],
    apiChangeCount: g.apiChangeCount,
    firstSeenAt: g.firstSeenAt,
    lastSeenAt: g.lastSeenAt,
    completedAt: g.rolling === 0 ? g.completedAt : null,
  };
}

const GROUP_STAGE = {
  $group: {
    _id: { channel: "$channel", group: "$group" },
    toBuild: { $first: "$toBuild" },
    fromBuilds: { $addToSet: "$fromBuild" },
    removal: { $max: { $cond: [{ $eq: ["$toSha", null] }, 1, 0] } },
    files: { $sum: { $cond: [{ $eq: ["$status", "abandoned"] }, 0, 1] } },
    // $avg skips nulls, so pulled-back files do not drag the share down.
    share: {
      $avg: {
        $switch: {
          branches: [
            { case: { $eq: ["$status", "abandoned"] }, then: null },
            { case: { $eq: ["$status", "complete"] }, then: 1 },
          ],
          default: { $ifNull: ["$recentShare", "$share"] },
        },
      },
    },
    minShare: { $min: { $ifNull: ["$recentShare", "$share"] } },
    sevRank: { $max: sevRank },
    apiChangeCount: { $sum: "$apiChangeCount" },
    firstSeenAt: { $min: "$firstSeenAt" },
    lastSeenAt: { $max: "$lastSeenAt" },
    completedAt: { $max: "$completedAt" },
    rolling: countStatus("rolling"),
    complete: countStatus("complete"),
    abandoned: countStatus("abandoned"),
  },
};

/**
 * Rollout groups, newest first. `before` is a firstSeenAt cursor for paging; `activeOnly` keeps groups
 * with at least one file still rolling. The only place group numbers are computed.
 */
export async function listGroups({ channel, severity, before, activeOnly = false, group, limit = 30 }) {
  const { rollouts } = await db();
  const match = { region: config.region };
  if (channel) match.channel = channel;
  if (group) match.group = group;
  const post = {};
  if (activeOnly) post.rolling = { $gt: 0 };
  if (severity) post.sevRank = SEVERITY_RANK[severity];
  if (before) post.firstSeenAt = { $lt: before };
  const rows = await rollouts
    .aggregate([{ $match: match }, GROUP_STAGE, { $match: post }, { $sort: { firstSeenAt: -1 } }, { $limit: limit }])
    .toArray();
  return rows.map(summarize);
}

/**
 * Every rollout page for the sitemap, newest change first. Only keys and dates: the share math of
 * listGroups is not needed here. 50 000 is the per-file limit of the sitemap protocol.
 */
export async function sitemapGroups() {
  const { rollouts } = await db();
  const rows = await rollouts
    .aggregate([
      { $match: { region: config.region } },
      {
        $group: {
          _id: { channel: "$channel", group: "$group" },
          lastSeenAt: { $max: "$lastSeenAt" },
          completedAt: { $max: "$completedAt" },
        },
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: 50_000 },
    ])
    .toArray();
  return rows.map((g) => ({
    channel: g._id.channel,
    group: g._id.group,
    lastModified: [g.lastSeenAt, g.completedAt].filter(Boolean).sort((a, b) => b - a)[0] ?? null,
  }));
}

/** Fewer points for the sparkline than we store. */
function downsample(history, points = 48) {
  if (history.length <= points) return history;
  const step = history.length / points;
  return Array.from({ length: points }, (_, i) => history[Math.floor(i * step)]).concat(history.at(-1));
}

/** Short human description of an API change from its stored before/after nodes. */
function describe(kind, before, after) {
  if (kind === "arityChanged") return `params ${before?.arity} → ${after?.arity}`;
  if (kind === "kindChanged") return `${before?.kind} → ${after?.kind}`;
  if (kind === "enumChanged") {
    const d = after?.delta;
    if (!d) return "";
    return [...d.removed.map((k) => `−${k}`), ...d.changed.map((k) => `~${k}`), ...d.added.map((k) => `+${k}`)].join(
      " ",
    );
  }
  if (kind === "added" || kind === "removed") return String((after ?? before)?.kind ?? "");
  if (kind === "renamed") return String(after?.kind ?? before?.kind ?? "");
  return "";
}

/** The same Office.* change usually appears in every host file; report it once with the file list. */
function groupApiChanges(rows) {
  const grouped = new Map();
  for (const c of rows) {
    const key = `${c.path}\u0000${c.kind}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.files.push(c.file);
      if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[existing.severity]) existing.severity = c.severity;
    } else {
      grouped.set(key, {
        path: c.path,
        from: c.from ?? null,
        kind: c.kind,
        severity: c.severity,
        apiStatus: c.apiStatus ?? null,
        apiSet: c.apiSet ?? null,
        files: [c.file],
        detail: describe(c.kind, c.before, c.after),
      });
    }
  }
  return [...grouped.values()].sort(
    (x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || x.path.localeCompare(y.path),
  );
}

export async function getGroup(channel, group) {
  const { rollouts, apiChanges } = await db();
  const items = await rollouts.find({ channel, region: config.region, group }).sort({ path: 1 }).toArray();
  if (items.length === 0) return null;
  const [summary] = await listGroups({ channel, group, limit: 1 });
  const changes = await apiChanges.find({ rolloutId: { $in: items.map((r) => r._id) } }).toArray();
  return {
    ...summary,
    region: config.region,
    hosts: items.map((r) => ({
      path: r.path,
      role: r.role,
      hostType: r.hostType,
      hostPlatform: r.hostPlatform,
      fromBuild: r.fromBuild,
      toBuild: r.toBuild,
      added: r.fromSha === null,
      removed: r.toSha === null,
      share: r.status === "complete" ? 1 : (r.recentShare ?? r.share),
      lastShare: r.share,
      peakShare: r.peakShare,
      status: r.status,
      severity: r.severity,
      apiChangeCount: r.apiChangeCount,
      firstSeenAt: r.firstSeenAt,
      completedAt: r.completedAt,
      history: downsample(r.history ?? []).map((h) => [h.at, h.share]),
    })),
    apiChanges: groupApiChanges(changes),
  };
}

/** Per channel: stable loader build, rollouts in flight, crawl health. */
export async function overview() {
  const { runs, fileStates, rollouts } = await db();
  const channels = [];
  for (const channel of config.channels) {
    const [lastRun, loader, active] = await Promise.all([
      runs.findOne({ channel, region: config.region }, { sort: { startedAt: -1 } }),
      fileStates.findOne({ channel, region: config.region, path: LOADER_PATH }),
      listGroups({ channel, activeOnly: true, limit: 10 }),
    ]);
    const lastChange = await rollouts.findOne(
      { channel, region: config.region },
      { sort: { firstSeenAt: -1 }, projection: { firstSeenAt: 1 } },
    );
    channels.push({
      channel,
      build: loader?.stableBuild ?? lastRun?.build ?? null,
      lastCrawlAt: lastRun?.startedAt ?? null,
      lastStatus: lastRun?.status ?? null,
      samples: lastRun?.samples ?? config.samples,
      lastChangeAt: lastChange?.firstSeenAt ?? null,
      active,
    });
  }
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const recent = await listGroups({ before: null, limit: 500 });
  const last30 = recent.filter((g) => new Date(g.firstSeenAt) >= since);
  return {
    channels,
    stats: { rollouts30d: last30.length, high30d: last30.filter((g) => g.severity === "high").length },
  };
}

/**
 * Crawler health for uptime monitors. Unhealthy when a channel has not finished a crawl within
 * HEALTH_STALE_MINUTES, its last crawl failed, or a crawl has been running for more than twice that.
 */
export async function crawlerHealth(now = Date.now()) {
  const { runs } = await db();
  const staleMs = config.healthStaleMinutes * 60_000;
  const channels = [];
  for (const channel of config.channels) {
    const [lastFinished, latest] = await Promise.all([
      runs.findOne({ channel, region: config.region, status: { $in: ["ok", "failed"] } }, { sort: { finishedAt: -1 } }),
      runs.findOne({ channel, region: config.region }, { sort: { startedAt: -1 } }),
    ]);
    const problems = [];
    const age = lastFinished?.finishedAt ? now - lastFinished.finishedAt.getTime() : null;
    if (age === null) problems.push("no finished crawl yet");
    else if (age > staleMs) problems.push(`last crawl finished ${Math.round(age / 60_000)} min ago`);
    if (lastFinished?.status === "failed")
      problems.push(`last crawl failed: ${String(lastFinished.error).slice(0, 200)}`);
    if (latest?.status === "running" && now - latest.startedAt.getTime() > 2 * staleMs) {
      problems.push(`crawl running for ${Math.round((now - latest.startedAt.getTime()) / 60_000)} min`);
    }
    channels.push({
      channel,
      ok: problems.length === 0,
      lastFinishedAt: lastFinished?.finishedAt ?? null,
      lastStatus: latest?.status ?? null,
      problems,
    });
  }
  return { ok: channels.every((c) => c.ok), channels, checkedAt: new Date(now) };
}
