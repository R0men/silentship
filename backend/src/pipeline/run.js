import { config, CHANNEL_BASE_URL } from "../config.js";
import { extractBuild } from "../crawler/build.js";
import { fetchFile, mapLimit } from "../crawler/fetcher.js";
import { bodyHashSansFlags, loaderFlags, parseLoader, sameFlags } from "../crawler/loader.js";
import { buildManifest, LOADER_PATH } from "../crawler/manifest.js";
import { formattedRel } from "../archive/git-archive.js";
import { formatJs } from "../analysis/format.js";
import { diffReflections, maxSeverity } from "../analysis/diff.js";
import { postProcess } from "../analysis/classify.js";
import { extractSurfaceIsolated } from "../analysis/surface-runner.js";
import { db } from "../db.js";
import { HISTORY_LIMIT, planFile, tallySamples } from "./rollouts.js";

const log = (channel, msg) => console.log(`[${new Date().toISOString()}] [${channel}] ${msg}`);

/** Abandoned rollouts younger than this are still matched, so a version that comes back revives its rollout. */
const REVIVE_WINDOW_MS = 30 * 24 * 3600_000;

/**
 * Rollouts of the same Microsoft build are shown together; files without a stamp group by content.
 * A removal is grouped per file: a file Microsoft drops leaves the loader's manifest and is never sampled,
 * so a 404 on a listed file is usually a CDN incident of that one file, and two unrelated ones must not
 * share a page (and its severity) just because they left the same stable build.
 */
export function groupKey({ toBuild, toSha, fromBuild, fromSha, path }) {
  if (toBuild) return toBuild;
  if (toSha) return `sha-${toSha.slice(0, 12)}`;
  const from = fromBuild ?? fromSha?.slice(0, 12) ?? "unknown";
  // Group keys go into URLs (GROUP_RE in web/server.js): word characters, dots and dashes, at most 80.
  const file = (path ?? "file").replace(/[^\w.-]+/g, "_").slice(0, 50);
  return `removed-${from}-${file}`;
}

/**
 * Fetch one file `samples` times on fresh connections. All requests are conditional on the stable
 * version's Last-Modified, so unchanged edges answer 304 with no body; on a full-refresh run the first
 * request is unconditional to re-verify the stable content itself.
 */
async function sampleFile(url, state, samples, forceFull) {
  const conditional = state?.stableSha && state.stableLM ? { lastModified: state.stableLM } : null;
  const results = [];
  for (let i = 0; i < samples; i++) {
    const useConditional = conditional && !(forceFull && i === 0);
    try {
      const r = await fetchFile(url, useConditional ? conditional : {});
      results.push({ ...r, build: r.body ? extractBuild(r.body.toString("utf8")) : null });
    } catch (error) {
      results.push({ error });
    }
  }
  return results;
}

async function loadStates(channel, region) {
  const { fileStates } = await db();
  const rows = await fileStates.find({ channel, region }).toArray();
  return new Map(rows.map((r) => [r.path, r]));
}

async function loadActiveRollouts(channel, region) {
  const { rollouts } = await db();
  const rows = await rollouts
    .find({
      channel,
      region,
      $or: [
        { status: "rolling" },
        { status: "abandoned", lastSeenAt: { $gte: new Date(Date.now() - REVIVE_WINDOW_MS) } },
      ],
    })
    .toArray();
  const byPath = new Map();
  for (const r of rows) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
  return byPath;
}

async function needsFullRefresh(channel, region) {
  const { runs } = await db();
  const last = await runs.findOne({ channel, region, full: true, status: "ok" }, { sort: { startedAt: -1 } });
  return !last || Date.now() - last.startedAt.getTime() > config.fullRefreshHours * 3600_000;
}

/**
 * Reflect (or read from cache) one stored version as { surface, error }. The error stays with the
 * surface so a diff can tell a partial reflection from a real removal. Bump the cache version whenever
 * reflection changes (v2: metadata-built classes are materialized, generated wrappers flagged).
 */
const SURFACE_CACHE = "surfaces/v2";

async function surfaceOf(archive, sha, role, loaderSha) {
  const key = role === "host" ? `${sha}@${loaderSha.slice(0, 12)}` : sha;
  const cached = await archive.read(`${SURFACE_CACHE}/${key}.json`);
  if (cached) return JSON.parse(cached.toString("utf8"));
  const target =
    role === "host" ? { loader: archive.blobPath(loaderSha), host: archive.blobPath(sha) } : archive.blobPath(sha);
  const { surface, error } = await extractSurfaceIsolated(target);
  const reflection = { surface, error: error ?? null };
  await archive.write(`${SURFACE_CACHE}/${key}.json`, JSON.stringify(reflection, null, 1) + "\n");
  return reflection;
}

/** API diff and severity for a new rollout. */
async function analyzeRollout(archive, channel, entry, create, loaderSha) {
  if (create.toSha === null) return { severity: "high", apiChanges: [] }; // file gone: hosts requesting it break
  if (create.fromSha === null) return { severity: "low", apiChanges: [] }; // new file
  if (entry.role !== "host" && entry.role !== "loader") return { severity: "low", apiChanges: [] };
  if (!archive.hasBlob(create.fromSha) || (entry.role === "host" && !loaderSha)) {
    log(channel, `no stored copy of the previous ${entry.path}; skipping API diff`);
    return { severity: "low", apiChanges: [] };
  }
  try {
    // One worker at a time: each may use up to WORKER_MAX_MB, and small VPSes have little RAM.
    const before = await surfaceOf(archive, create.fromSha, entry.role, loaderSha);
    const after = await surfaceOf(archive, create.toSha, entry.role, loaderSha);
    const { changes: raw, note } = diffReflections(before, after);
    // Renames instead of remove+add pairs; preview and undocumented APIs never above low.
    const apiChanges = postProcess(raw);
    if (note) log(channel, `${entry.path}: ${note}`);
    return { severity: maxSeverity(apiChanges.map((c) => c.severity)), apiChanges, note };
  } catch (err) {
    log(channel, `API diff failed for ${entry.path}: ${String(err)}`);
    return { severity: "low", apiChanges: [] };
  }
}

export const LOADER_FLAGS_CHANGED = "loader-flags-changed";

/**
 * The `loader-flags-changed` event: a new office.js sets the security-default flags differently from the
 * stable one — e.g. the legacy endpoint adopting OneCDN's defaults, which stops loading MicrosoftAjax for
 * every add-in it reaches. Always High. null when the flags are the same or the previous loader is unknown.
 */
export function loaderFlagsEvent(fromSource, toSource) {
  if (fromSource == null || toSource == null) return null;
  const from = loaderFlags(fromSource);
  const to = loaderFlags(toSource);
  return sameFlags(from, to) ? null : { event: LOADER_FLAGS_CHANGED, severity: "high", from, to };
}

/** Flags of a new loader version and of the one it replaces, and its hash without them. */
async function loaderFacts(archive, create) {
  const to = create.body.toString("utf8");
  const before = create.fromSha ? await archive.readBlob(create.fromSha) : null;
  const from = before ? before.toString("utf8") : null;
  const event = loaderFlagsEvent(from, to);
  return {
    fromFlags: from === null ? null : loaderFlags(from),
    toFlags: loaderFlags(to),
    bodyHashSansFlags: bodyHashSansFlags(to),
    flagsChanged: event !== null,
  };
}

export async function runChannel(channel, archive) {
  const region = config.region;
  const base = CHANNEL_BASE_URL[channel];
  const samples = config.samples;
  const now = new Date();
  const { runs, snapshots, rollouts, apiChanges, fileStates } = await db();
  const [states, activeByPath, forceFull] = await Promise.all([
    loadStates(channel, region),
    loadActiveRollouts(channel, region),
    needsFullRefresh(channel, region),
  ]);
  // A channel's first run (a newly added endpoint): what the CDN serves is the baseline, not a release.
  const bootstrap = states.size === 0;
  const { insertedId: runId } = await runs.insertOne({
    channel,
    region,
    full: forceFull,
    bootstrap,
    samples,
    startedAt: now,
    finishedAt: null,
    status: "running",
    error: null,
    build: null,
  });

  try {
    // 1. Loader first: its version map decides which host files exist. Edges may serve several loader
    //    versions mid-rollout, so the manifest is the union over all of them.
    const loaderState = states.get(LOADER_PATH);
    const loaderResults = await sampleFile(base + LOADER_PATH, loaderState, samples, forceFull);
    const loaderBodies = loaderResults.filter((r) => r.body).map((r) => r.body);
    if (loaderState?.stableSha) {
      const stable = await archive.readBlob(loaderState.stableSha);
      if (stable) loaderBodies.push(stable);
    }
    if (loaderBodies.length === 0) throw new Error(`No usable response for ${base + LOADER_PATH}`);
    const manifest = new Map();
    for (const body of loaderBodies) {
      const info = parseLoader(body.toString("utf8"));
      if (Object.keys(info.hostMap).length === 0) continue;
      for (const e of buildManifest(info, config.locales)) if (!manifest.has(e.path)) manifest.set(e.path, e);
    }
    if (manifest.size === 0) throw new Error("HostSpecificFileVersionMap not found in any loader; format changed?");

    // 2. Sample everything else.
    const others = [...manifest.values()].filter((e) => e.path !== LOADER_PATH);
    const otherResults = await mapLimit(others, config.fetchConcurrency, (e) =>
      sampleFile(base + e.path, states.get(e.path), samples, forceFull),
    );
    const sampled = [
      { entry: manifest.get(LOADER_PATH), results: loaderResults },
      ...others.map((entry, i) => ({ entry, results: otherResults[i] })),
    ];

    // 3. Decide per file.
    const plans = sampled.map(({ entry, results }) => {
      const state = states.get(entry.path) ?? null;
      const tally = tallySamples(results, state);
      const plan = planFile({ state, tally, rollouts: activeByPath.get(entry.path) ?? [], now, bootstrap });
      return { entry, results, tally, plan };
    });

    // 4. Store content: every stable version we hold a body for, and every new rollout target.
    let archived = 0;
    for (const { tally, plan } of plans) {
      const stable = plan.state && tally.variants.get(plan.state.stableSha ?? "absent");
      if (stable?.sha && stable.body && (await archive.putBlob(stable.sha, stable.body))) archived++;
      for (const c of plan.creates) if (c.toSha && c.body && (await archive.putBlob(c.toSha, c.body))) archived++;
    }

    // 5. Analyze new rollouts against the stable loader (after this run's promotions).
    const loaderSha = plans.find((p) => p.entry.path === LOADER_PATH)?.plan.state?.stableSha ?? null;
    const createdDocs = [];
    for (const { entry, plan } of plans) {
      for (const c of plan.creates) {
        const analysis = await analyzeRollout(archive, channel, entry, c, loaderSha);
        const loader = entry.role === "loader" && c.toSha && c.body ? await loaderFacts(archive, c) : null;
        if (loader?.flagsChanged) {
          analysis.severity = "high";
          log(channel, `${LOADER_FLAGS_CHANGED}: ${JSON.stringify(loader.fromFlags)} → ${JSON.stringify(loader.toFlags)}`);
        }
        if (c.toSha && c.body) {
          const formatted = await formatJs(c.body.toString("utf8"));
          if (formatted !== null) await archive.write(formattedRel(channel, region, entry.path), formatted);
        }
        createdDocs.push({ entry, create: c, analysis, loader });
      }
    }
    const commit =
      archived > 0 || createdDocs.length > 0
        ? await archive.commit(
            `${channel}/${region}: ${createdDocs.length} new rollout(s), ${archived} new file version(s)`,
          )
        : null;

    // 6. Persist.
    for (const { entry, create: c, analysis, loader } of createdDocs) {
      const doc = {
        channel,
        region,
        path: entry.path,
        role: entry.role,
        hostType: entry.hostType ?? null,
        hostPlatform: entry.hostPlatform ?? null,
        fromSha: c.fromSha,
        fromBuild: c.fromBuild,
        toSha: c.toSha,
        toBuild: c.toBuild,
        toLastModified: c.toLastModified,
        group: groupKey({ ...c, path: entry.path }),
        status: "rolling",
        share: c.share,
        recentShare: c.share,
        peakShare: c.share,
        samples: c.samples,
        fullRuns: c.share >= 1 ? 1 : 0,
        zeroSince: null,
        history: [{ at: now, share: c.share }],
        edges: c.edges,
        firstSeenAt: now,
        lastSeenAt: now,
        completedAt: null,
        severity: analysis.severity,
        apiChangeCount: analysis.apiChanges.length,
        // Why the API diff is not complete (partial or truncated reflection), if it is not.
        apiDiffNote: analysis.note ?? null,
        // office.js only: fromFlags, toFlags, bodyHashSansFlags, flagsChanged (the loader-flags-changed event).
        ...loader,
        archiveCommit: commit,
        notifiedAt: null,
      };
      const { insertedId } = await rollouts.insertOne(doc);
      if (analysis.apiChanges.length) {
        await apiChanges.insertMany(
          analysis.apiChanges.map((a) => ({
            rolloutId: insertedId,
            file: entry.path,
            path: a.path,
            kind: a.kind,
            severity: a.severity,
            from: a.from ?? null,
            apiStatus: a.apiStatus ?? null,
            apiSet: a.apiSet ?? null,
            before: a.before ?? null,
            after: a.detail ? { ...a.after, delta: a.detail } : (a.after ?? null),
          })),
        );
      }
    }

    let completed = 0;
    let stale = 0;
    let wireBytes = 0;
    const snapshotDocs = [];
    for (const { entry, results, tally, plan } of plans) {
      stale += plan.stale;
      for (const u of plan.updates) {
        if (u.status === "complete") completed++;
        const { id, ...fields } = u;
        await rollouts.updateOne(
          { _id: id },
          { $set: fields, $push: { history: { $each: [{ at: now, share: u.share }], $slice: -HISTORY_LIMIT } } },
        );
      }
      if (plan.state) {
        // The stable loader's security-default flags, and its hash without them for comparing endpoints.
        const stableLoader =
          entry.role === "loader" && plan.state.stableSha ? await archive.readBlob(plan.state.stableSha) : null;
        await fileStates.updateOne(
          { channel, region, path: entry.path },
          {
            $set: {
              stableSha: plan.state.stableSha,
              stableBuild: plan.state.stableBuild,
              stableLM: plan.state.stableLM,
              retiredShas: plan.state.retiredShas,
              role: entry.role,
              hostType: entry.hostType ?? null,
              ...(stableLoader && {
                stableFlags: loaderFlags(stableLoader.toString("utf8")),
                stableBodyHashSansFlags: bodyHashSansFlags(stableLoader.toString("utf8")),
              }),
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }
      const variants = [...tally.variants.values()].sort((a, b) => b.count - a.count);
      const bytes = results.reduce((n, r) => n + (r.wireBytes ?? 0), 0);
      wireBytes += bytes;
      snapshotDocs.push({
        runId,
        channel,
        region,
        path: entry.path,
        fetchedAt: now,
        samples: tally.samples,
        errors: tally.errors,
        build: variants.find((v) => v.sha !== null)?.build ?? null,
        variants: variants.map((v) => ({ sha: v.sha, build: v.build, count: v.count, lastModified: v.lastModified })),
        edges: [...new Set(results.map((r) => r.edgeIp).filter(Boolean))],
        wireBytes: bytes,
      });
    }
    if (snapshotDocs.length) await snapshots.insertMany(snapshotDocs);

    const loaderPlan = plans.find((p) => p.entry.path === LOADER_PATH)?.plan;
    const build = loaderPlan?.state?.stableBuild ?? null;
    const finishedAt = new Date();
    const durationMs = finishedAt - now;
    await runs.updateOne(
      { _id: runId },
      {
        $set: {
          status: "ok",
          finishedAt,
          durationMs,
          build,
          files: plans.length,
          requests: plans.reduce((n, p) => n + p.results.length, 0),
          wireBytes,
          created: createdDocs.length,
          completed,
          stale,
        },
      },
    );
    log(
      channel,
      `${bootstrap ? "baseline recorded (first run, no rollouts): " : ""}` +
        `build ${build}, ${plans.length} files × ${samples} samples, ${(wireBytes / 1e6).toFixed(1)} MB in ` +
        `${(durationMs / 1000).toFixed(1)} s; ` +
        `${createdDocs.length} new rollout(s), ${completed} completed, ${stale} stale-edge sample(s)`,
    );
    return { runId, created: createdDocs.length, completed };
  } catch (err) {
    await runs.updateOne(
      { _id: runId },
      { $set: { status: "failed", finishedAt: new Date(), error: String(err).slice(0, 2000) } },
    );
    throw err;
  }
}
