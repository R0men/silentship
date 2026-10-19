import { config, LEGACY_CHANNEL, legacyOf, pairedChannel } from "../config.js";
import { db } from "../db.js";
import { SEVERITY_RANK } from "../analysis/diff.js";
import { apiStatus, learnUrl } from "../analysis/api-catalog.js";
import { flagsChangeNotice, MS_CDN_DOCS } from "../crawler/loader.js";
import { LOADER_PATH } from "../crawler/manifest.js";
import { CONFIRM_RUNS } from "../pipeline/rollouts.js";

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

/**
 * groupConfirmed (notify/alerts.js) as an aggregate: 1 when any file of the group completed or was sighted
 * in CONFIRM_RUNS runs. Unconfirmed groups (one-run CDN incidents) are not shown anywhere on the site.
 */
const CONFIRMED = {
  $max: {
    $cond: [
      {
        $or: [
          { $eq: ["$status", "complete"] },
          {
            $gte: [
              { $size: { $filter: { input: { $ifNull: ["$history", []] }, cond: { $gt: ["$$this.share", 0] } } } },
              CONFIRM_RUNS,
            ],
          },
        ],
      },
      1,
      0,
    ],
  },
};

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
    confirmed: CONFIRMED,
  },
};

/**
 * Confirmed rollout groups, newest first. `before` is a firstSeenAt cursor for paging; `activeOnly` keeps
 * groups with at least one file still rolling. The only place group numbers are computed.
 */
export async function listGroups({ channel, severity, before, activeOnly = false, group, groups, limit = 30 }) {
  const { rollouts } = await db();
  const match = { region: config.region };
  if (channel) match.channel = channel;
  if (group) match.group = group;
  else if (groups) match.group = { $in: groups };
  const post = { confirmed: 1 };
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
          confirmed: CONFIRMED,
        },
      },
      { $match: { confirmed: 1 } },
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
        type: apiTypeOf(c.path),
        fromType: c.from ? apiTypeOf(c.from) : null,
      });
    }
  }
  return [...grouped.values()].sort(
    (x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || x.path.localeCompare(y.path),
  );
}

/** office.js of a build on a channel: its loader rollout in the group, else the stable loader if on that build. */
async function loaderOf(channel, group) {
  const { rollouts, fileStates } = await db();
  const r = await rollouts.findOne(
    { channel, region: config.region, group, path: LOADER_PATH, toSha: { $ne: null }, status: { $ne: "abandoned" } },
    { sort: { firstSeenAt: -1 } },
  );
  if (r) return { sha: r.toSha, sansFlags: r.bodyHashSansFlags ?? null };
  const s = await fileStates.findOne({ channel, region: config.region, path: LOADER_PATH, stableBuild: group });
  return s ? { sha: s.stableSha, sansFlags: s.stableBodyHashSansFlags ?? null } : null;
}

export async function getGroup(channel, group) {
  const { rollouts, apiChanges } = await db();
  const [summary] = await listGroups({ channel, group, limit: 1 });
  if (!summary) return null; // unknown or unconfirmed
  const items = await rollouts.find({ channel, region: config.region, group }).sort({ path: 1 }).toArray();
  const changes = await apiChanges.find({ rolloutId: { $in: items.map((r) => r._id) } }).toArray();
  const flagged = items.find((r) => r.flagsChanged && r.status !== "abandoned");
  return {
    ...summary,
    region: config.region,
    // loader-flags-changed: office.js of this build sets the security defaults differently.
    flags: flagged
      ? {
          from: flagged.fromFlags,
          to: flagged.toFlags,
          notice: flagsChangeNotice(channel, flagged.fromFlags, flagged.toFlags),
          docs: MS_CDN_DOCS,
        }
      : null,
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

/*
 * Releases: what the site shows. The legacy and OneCDN endpoints of a track (prod, beta) serve the same
 * host files, so one Microsoft build is a group on each; a release is that build once, with both endpoints
 * side by side. Numbers (files, share, API changes, severity) come from the legacy group, or the OneCDN one
 * when legacy has not shown the build. Alerts keep working on groups.
 */

/** Tracks are the legacy channels; each may have a crawled OneCDN twin. */
export const TRACKS = Object.values(LEGACY_CHANNEL);
export const isTrack = (track) => TRACKS.includes(track);

function endpointsOf(track) {
  const onecdn = pairedChannel(track);
  return { legacy: track, onecdn: config.channels.includes(onecdn) ? onecdn : null };
}

/** An endpoint's side of a release, as the rollout page and the list need it. */
const endpointView = (g) => ({
  channel: g.channel,
  status: g.status,
  share: g.status === "complete" ? 1 : g.share,
  files: g.files,
  severity: g.severity,
  apiChangeCount: g.apiChangeCount,
  firstSeenAt: g.firstSeenAt,
  completedAt: g.completedAt,
});

async function groupsByKey(channel, keys) {
  if (!channel || !keys.length) return new Map();
  const rows = await listGroups({ channel, groups: keys, limit: keys.length });
  return new Map(rows.map((g) => [g.group, g]));
}

/** Builds some file of `channel` is stable on: an endpoint that started on a build never had it as a rollout. */
async function stableBuilds(channel, keys) {
  if (!channel || !keys.length) return new Set();
  const { fileStates } = await db();
  return new Set(
    await fileStates.distinct("stableBuild", { channel, region: config.region, stableBuild: { $in: keys } }),
  );
}

/**
 * Where the endpoints of each release differ: host files whose version is not the same (the group's rollout
 * on that endpoint, else the endpoint's stable version), and loader security-default flags that changed
 * (loader-flags-changed). office.js is left out of the file comparison: it always differs by the flags.
 */
async function compareEndpoints(ep, releases) {
  for (const r of releases) Object.assign(r, { differentFiles: [], flagsChanged: false, diverged: false });
  if (!releases.length) return;
  const { rollouts, fileStates } = await db();
  const channels = [ep.legacy, ep.onecdn].filter(Boolean);
  const [docs, states] = await Promise.all([
    rollouts
      .find({
        region: config.region,
        channel: { $in: channels },
        group: { $in: releases.map((r) => r.group) },
        status: { $ne: "abandoned" },
      })
      .project({ channel: 1, group: 1, path: 1, toSha: 1, flagsChanged: 1, firstSeenAt: 1 })
      .sort({ firstSeenAt: 1 })
      .toArray(),
    ep.onecdn
      ? fileStates
          .find({ region: config.region, channel: { $in: channels } })
          .project({ channel: 1, path: 1, stableSha: 1 })
          .toArray()
      : [],
  ]);
  const stable = new Map(states.map((s) => [`${s.channel}/${s.path}`, s.stableSha]));
  for (const r of releases) {
    const own = docs.filter((d) => d.group === r.group);
    r.flagsChanged = own.some((d) => d.flagsChanged);
    if (!ep.onecdn) {
      r.diverged = r.flagsChanged;
      continue;
    }
    // Sorted oldest first, so a newer rollout of the same file wins.
    const version = new Map(own.map((d) => [`${d.channel}/${d.path}`, d.toSha]));
    const versionOf = (channel, path) => {
      const k = `${channel}/${path}`;
      return version.has(k) ? version.get(k) : stable.get(k);
    };
    const both = Boolean(r.endpoints.legacy && r.endpoints.onecdn);
    const paths = [...new Set(own.map((d) => d.path))].filter((p) => p !== LOADER_PATH).sort();
    r.differentFiles = both ? paths.filter((p) => versionOf(ep.legacy, p) !== versionOf(ep.onecdn, p)) : [];
    r.diverged = !both || r.differentFiles.length > 0 || r.flagsChanged;
  }
}

/** Releases of one track for the given group keys, filtered on their primary group. */
async function releasesOf(track, keys, { severity, before, activeOnly = false } = {}) {
  const ep = endpointsOf(track);
  const [legacy, onecdn, legacyStable, onecdnStable] = await Promise.all([
    groupsByKey(ep.legacy, keys),
    groupsByKey(ep.onecdn, keys),
    stableBuilds(ep.legacy, keys),
    stableBuilds(ep.onecdn, keys),
  ]);
  // A side is the endpoint's group, `stable` when the endpoint started on this build, or null (not seen).
  const side = (groups, stable, channel, key) =>
    groups.has(key) ? endpointView(groups.get(key)) : stable.has(key) ? { channel, status: "stable" } : null;
  const out = [];
  for (const key of keys) {
    const primary = legacy.get(key) ?? onecdn.get(key);
    if (!primary) continue;
    const endpoints = {
      legacy: side(legacy, legacyStable, ep.legacy, key),
      onecdn: ep.onecdn ? side(onecdn, onecdnStable, ep.onecdn, key) : null,
    };
    if (severity && primary.severity !== severity) continue;
    if (before && !(primary.firstSeenAt < before)) continue;
    if (activeOnly && ![endpoints.legacy, endpoints.onecdn].some((e) => e?.status === "rolling")) continue;
    out.push({ ...primary, channel: track, endpoints, onecdnCrawled: Boolean(ep.onecdn) });
  }
  await compareEndpoints(ep, out);
  return out;
}

/**
 * Releases newest first, one per track and build. Candidates come from each endpoint with the same filters;
 * a release is then judged on its primary group, so paging by `before` sees it once. OneCDN candidates are
 * fetched with headroom: most of them are builds legacy also has and are dropped as duplicates.
 */
export async function listReleases({ track, severity, before, activeOnly = false, limit = 30 }) {
  const out = [];
  for (const t of track ? [track] : TRACKS) {
    const ep = endpointsOf(t);
    const filters = { severity, before, activeOnly };
    const candidates = [
      ...(await listGroups({ channel: ep.legacy, ...filters, limit })),
      ...(ep.onecdn ? await listGroups({ channel: ep.onecdn, ...filters, limit: limit * 2 }) : []),
    ];
    const keys = [...new Set(candidates.map((g) => g.group))];
    out.push(...(await releasesOf(t, keys, filters)));
  }
  return out.sort((a, b) => b.firstSeenAt - a.firstSeenAt).slice(0, limit);
}

/** One release for /rollouts/<track>/<build>: both endpoints, the primary group's files and API changes. */
export async function getRelease(track, group) {
  if (!isTrack(track)) return null;
  const [release] = await releasesOf(track, [group]);
  if (!release) return null;
  const ep = endpointsOf(track);
  const [legacy, onecdn, legacyLoader, onecdnLoader] = await Promise.all([
    getGroup(ep.legacy, group),
    ep.onecdn ? getGroup(ep.onecdn, group) : null,
    loaderOf(ep.legacy, group),
    ep.onecdn ? loaderOf(ep.onecdn, group) : null,
  ]);
  const primary = legacy ?? onecdn;
  // How the two office.js compare: identical, flags-only (same code but the security-default flags), different.
  let loader = null;
  if (legacyLoader && onecdnLoader) {
    if (legacyLoader.sha === onecdnLoader.sha) loader = "identical";
    else if (legacyLoader.sansFlags && legacyLoader.sansFlags === onecdnLoader.sansFlags) loader = "flags-only";
    else if (legacyLoader.sansFlags && onecdnLoader.sansFlags) loader = "different";
  }
  return {
    ...release,
    region: primary.region,
    hosts: primary.hosts,
    apiChanges: primary.apiChanges,
    // loader-flags-changed on either endpoint; empty unless the flags actually changed.
    flags: [
      legacy?.flags && { endpoint: "legacy", ...legacy.flags },
      onecdn?.flags && { endpoint: "onecdn", ...onecdn.flags },
    ].filter(Boolean),
    loader,
  };
}

/** Every release page for the sitemap: rollout groups keyed by track, a build on both endpoints once. */
export async function sitemapReleases() {
  const byKey = new Map();
  for (const g of await sitemapGroups()) {
    const channel = legacyOf(g.channel);
    const key = `${channel}/${g.group}`;
    const prev = byKey.get(key);
    const lastModified = [prev?.lastModified, g.lastModified].filter(Boolean).sort((a, b) => b - a)[0] ?? null;
    byKey.set(key, { channel, group: g.group, lastModified });
  }
  return [...byKey.values()];
}

/**
 * The API type a changed path belongs to — the unit of a /reference page: the path up to its last
 * PascalCase segment after the root (classes and enums are PascalCase, members camelCase; enum values are
 * not separate paths). `Excel.Copilot.allowedUrls` → `Excel.Copilot`. A path without one
 * (`Office.context.document.getFileAsync`) belongs to its parent object; a two-segment one (`Excel.run`)
 * is its own type.
 */
export function apiTypeOf(path) {
  const segs = path.split(".");
  for (let i = segs.length - 1; i >= 1; i--) if (/^[A-Z]/.test(segs[i])) return segs.slice(0, i + 1).join(".");
  return segs.length > 2 ? segs.slice(0, -1).join(".") : path;
}

/**
 * API type pages follow the legacy channels only: OneCDN serves the same host files, so its groups would
 * repeat every change of a build on a second row.
 */
const ONECDN_CHANNELS = Object.keys(LEGACY_CHANNEL);

/** A dotted JavaScript identifier path, as the reflection produces them. */
export const TYPE_RE = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*){0,9}$/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const latest = (dates) => dates.filter(Boolean).sort((a, b) => b - a)[0] ?? null;
const keyOf = (channel, group) => `${channel}/${group}`;
const splitKey = (k) => ({ channel: k.slice(0, k.indexOf("/")), group: k.slice(k.indexOf("/") + 1) });

/** Summaries of the given groups that are confirmed, by `channel/group`; numbers come from listGroups. */
async function confirmedGroups(keys) {
  const out = new Map();
  for (const k of new Set(keys)) {
    const [summary] = await listGroups({ ...splitKey(k), limit: 1 });
    if (summary) out.set(k, summary);
  }
  return out;
}

/** apiChanges rows of `type`: by `path`, or by `from` for the old name of a rename. */
async function typeRows(type, flags = "") {
  const { apiChanges } = await db();
  const re = new RegExp(`^${escapeRe(type)}(\\.|$)`, flags);
  const lower = type.toLowerCase();
  const rows = await apiChanges.find({ $or: [{ path: re }, { from: re }] }).toArray();
  return rows.filter((c) => [c.path, c.from].some((p) => p && apiTypeOf(p).toLowerCase() === lower));
}

/**
 * Change history of one API type across confirmed rollouts, for /reference/<type>. A rename shows on the
 * pages of both names. The lookup is exact; when nothing matches, a case-insensitive retry finds the
 * canonical spelling (`type` in the result) so the page can redirect. null — never changed in a confirmed
 * rollout.
 */
export async function getApiType(type) {
  if (!TYPE_RE.test(type)) return null;
  const { rollouts, apiChanges } = await db();
  let rows = await typeRows(type);
  let canonical = type;
  if (!rows.length) {
    rows = await typeRows(type, "i");
    const lower = type.toLowerCase();
    const hit = rows.flatMap((c) => [c.path, c.from]).find((p) => p && apiTypeOf(p).toLowerCase() === lower);
    if (!hit) return null;
    canonical = apiTypeOf(hit);
    rows = rows.filter((c) => [c.path, c.from].some((p) => p && apiTypeOf(p) === canonical));
  }

  const ids = [...new Map(rows.map((c) => [String(c.rolloutId), c.rolloutId])).values()];
  const docs = await rollouts
    .find({ _id: { $in: ids }, region: config.region, channel: { $nin: ONECDN_CHANNELS } })
    .project({ channel: 1, group: 1, path: 1, status: 1, lastSeenAt: 1, completedAt: 1 })
    .toArray();
  const byId = new Map(docs.map((r) => [String(r._id), r]));
  const groups = await confirmedGroups(docs.map((r) => keyOf(r.channel, r.group)));

  // One event per (group, path, kind): the same change in every host file is one row with the file list.
  const events = new Map();
  for (const c of rows) {
    const r = byId.get(String(c.rolloutId));
    const g = r && groups.get(keyOf(r.channel, r.group));
    if (!g) continue; // another region, or a group that was never confirmed
    const key = `${keyOf(g.channel, g.group)}\u0000${c.path}\u0000${c.kind}`;
    let e = events.get(key);
    if (!e) {
      e = {
        channel: g.channel,
        group: g.group,
        toBuild: g.toBuild,
        fromBuilds: g.fromBuilds,
        removal: g.removal,
        groupStatus: g.status,
        share: g.status === "complete" ? 1 : g.share,
        firstSeenAt: g.firstSeenAt,
        completedAt: g.completedAt,
        path: c.path,
        from: c.from ?? null,
        type: apiTypeOf(c.path),
        fromType: c.from ? apiTypeOf(c.from) : null,
        kind: c.kind,
        severity: c.severity,
        apiStatus: c.apiStatus ?? null,
        apiSet: c.apiSet ?? null,
        detail: describe(c.kind, c.before, c.after),
        files: [],
        pulledFiles: [],
        lastModified: null,
      };
      events.set(key, e);
    }
    (r.status === "abandoned" ? e.pulledFiles : e.files).push(r.path);
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[e.severity]) e.severity = c.severity;
    e.lastModified = latest([e.lastModified, r.lastSeenAt, r.completedAt]);
  }
  if (!events.size) return null;

  // A change whose files were all pulled back did not stick, whatever the rest of its build did.
  const list = [...events.values()]
    .map(({ groupStatus, ...e }) => ({
      ...e,
      status: e.files.length ? groupStatus : "abandoned",
      files: e.files.sort(),
      pulledFiles: e.pulledFiles.sort(),
    }))
    .sort((a, b) => b.firstSeenAt - a.firstSeenAt || a.path.localeCompare(b.path));

  // Other types changed by the same rollouts: what a reader of this page most likely wants next.
  const keys = [...new Set(list.map((e) => keyOf(e.channel, e.group)))];
  const siblings = await rollouts
    .find({ region: config.region, $or: keys.map(splitKey) })
    .project({ _id: 1 })
    .toArray();
  const near = await apiChanges
    .find({ rolloutId: { $in: siblings.map((r) => r._id) } })
    .project({ path: 1, kind: 1, severity: 1 })
    .toArray();
  const related = new Map();
  for (const c of near) {
    const t = apiTypeOf(c.path);
    const prev = related.get(t);
    if (t !== canonical && (!prev || SEVERITY_RANK[c.severity] > SEVERITY_RANK[prev.severity])) {
      related.set(t, { type: t, kind: c.kind, severity: c.severity });
    }
  }

  return {
    type: canonical,
    namespace: canonical.split(".")[0],
    // Today's documentation from the bundled @types packages: GA / preview / undocumented, and its page.
    docs: { ...apiStatus(canonical), url: learnUrl(canonical) },
    events: list,
    lastModified: latest(list.map((e) => e.lastModified)),
    related: [...related.values()]
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.type.localeCompare(b.type))
      .slice(0, 12),
  };
}

/**
 * Every API type changed by a confirmed rollout, newest first, for the /reference hub and the sitemap:
 * channels, kinds of change, number of changed paths, highest severity, dates.
 */
export async function listApiTypes() {
  const { rollouts, apiChanges } = await db();
  const confirmed = (await sitemapGroups()).filter((g) => !ONECDN_CHANNELS.includes(g.channel));
  if (!confirmed.length) return [];
  const docs = await rollouts
    .find({ region: config.region, $or: confirmed.map(({ channel, group }) => ({ channel, group })) })
    .project({ channel: 1, group: 1, firstSeenAt: 1, lastSeenAt: 1, completedAt: 1 })
    .toArray();
  const byId = new Map(docs.map((r) => [String(r._id), r]));
  // A type's date is when its rollout group was first seen, as on the rollout page — not one file's sighting.
  const groupFirst = new Map();
  for (const r of docs) {
    const k = keyOf(r.channel, r.group);
    if (!groupFirst.has(k) || r.firstSeenAt < groupFirst.get(k)) groupFirst.set(k, r.firstSeenAt);
  }
  const rows = await apiChanges
    .aggregate([
      { $match: { rolloutId: { $in: docs.map((r) => r._id) } } },
      {
        $group: {
          _id: { path: "$path", from: "$from", kind: "$kind" },
          sevRank: { $max: sevRank },
          ids: { $addToSet: "$rolloutId" },
        },
      },
    ])
    .toArray();

  const types = new Map();
  const add = (type, row, rs) => {
    let t = types.get(type);
    if (!t) {
      t = { type, kinds: new Set(), channels: new Set(), paths: new Set(), sevRank: 0, lastSeenAt: null, lastModified: null };
      types.set(type, t);
    }
    t.kinds.add(row._id.kind);
    t.paths.add(row._id.path);
    t.sevRank = Math.max(t.sevRank, row.sevRank);
    for (const r of rs) {
      t.channels.add(r.channel);
      t.lastSeenAt = latest([t.lastSeenAt, groupFirst.get(keyOf(r.channel, r.group))]);
      t.lastModified = latest([t.lastModified, r.lastSeenAt, r.completedAt]);
    }
  };
  for (const row of rows) {
    const rs = row.ids.map((id) => byId.get(String(id))).filter(Boolean);
    const type = apiTypeOf(row._id.path);
    add(type, row, rs);
    if (row._id.from && apiTypeOf(row._id.from) !== type) add(apiTypeOf(row._id.from), row, rs);
  }
  return [...types.values()]
    .map((t) => ({
      type: t.type,
      namespace: t.type.split(".")[0],
      kinds: [...t.kinds].sort(),
      channels: ["prod", "beta"].filter((c) => t.channels.has(c)),
      changes: t.paths.size,
      severity: SEVERITY_NAME[t.sevRank],
      docs: apiStatus(t.type),
      lastSeenAt: t.lastSeenAt,
      lastModified: t.lastModified,
    }))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.type.localeCompare(b.type));
}

/** One endpoint's crawl state: its stable loader build and last run. */
async function endpointState(channel) {
  const { runs, fileStates } = await db();
  const [lastRun, loader] = await Promise.all([
    runs.findOne({ channel, region: config.region }, { sort: { startedAt: -1 } }),
    fileStates.findOne({ channel, region: config.region, path: LOADER_PATH }),
  ]);
  return {
    channel,
    build: loader?.stableBuild ?? lastRun?.build ?? null,
    lastCrawlAt: lastRun?.startedAt ?? null,
    lastStatus: lastRun?.status ?? null,
    samples: lastRun?.samples ?? config.samples,
  };
}

/**
 * Per track (production, beta): the stable build and crawl state of both endpoints, releases in flight.
 * The card's build and status follow legacy; `endpoints` says whether OneCDN serves the same build.
 */
export async function overview() {
  const channels = [];
  for (const track of TRACKS) {
    const ep = endpointsOf(track);
    if (!config.channels.includes(track) && !ep.onecdn) continue;
    const [legacy, onecdn, active, [lastChange]] = await Promise.all([
      config.channels.includes(track) ? endpointState(track) : null,
      ep.onecdn ? endpointState(ep.onecdn) : null,
      listReleases({ track, activeOnly: true, limit: 10 }),
      listReleases({ track, limit: 1 }),
    ]);
    const main = legacy ?? onecdn;
    const states = [legacy, onecdn].filter(Boolean);
    channels.push({
      channel: track,
      build: main.build,
      lastCrawlAt: latest(states.map((e) => e.lastCrawlAt)),
      lastStatus: states.some((e) => e.lastStatus === "failed")
        ? "failed"
        : states.some((e) => e.lastStatus === "running")
          ? "running"
          : main.lastStatus,
      samples: main.samples,
      lastChangeAt: lastChange?.firstSeenAt ?? null,
      // The newest release, so a quiet card still shows where the last one ended (complete, pulled back).
      latest: lastChange ?? null,
      endpoints: { legacy, onecdn },
      active,
    });
  }
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const recent = await listGroups({ before: null, limit: 500 });
  const last30 = recent.filter((g) => new Date(g.firstSeenAt) >= since);
  // A build reaching both tracks and both endpoints is four groups but one build; removals and unstamped
  // changes are no build.
  const builds = new Set(last30.filter((g) => g.toBuild).map((g) => g.toBuild));
  const high = new Set(
    last30.filter((g) => g.severity === "high").map((g) => g.toBuild ?? `${legacyOf(g.channel)}/${g.group}`),
  );
  return { channels, stats: { rollouts30d: builds.size, high30d: high.size } };
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
