import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * runChannel end to end on synthetic CDN responses: when a channel's first run is a baseline (bootstrap)
 * and when it is not. Network and the reflection worker are mocked; MongoDB and the git archive are real.
 */

// Edges serve these versions in turn; an edge answers 304 when its version is not newer than the
// If-Modified-Since date, as Akamai does.
const cdn = { versions: new Map(), turn: new Map() };
const loader = (build) =>
  `var OSF=OSF||{};OSF.HostSpecificFileVersionMap={excel:{web:"16.00"}};` +
  `OSF.ConstantNames={FileVersion:"${build}",OfficeJS:"office.js"};`;
const host = (build) => `var Excel={};Excel.x=1;t.hostJSVersion="${build}";`;
const OLD = { build: "16.0.20528.15060", lastModified: "Fri, 09 Oct 2026 00:00:00 GMT" };
const NEW = { build: "16.0.20606.15070", lastModified: "Tue, 13 Oct 2026 00:00:00 GMT" };
function serve(...versions) {
  cdn.versions.set("office.js", versions.map((v) => ({ ...v, body: loader(v.build) })));
  cdn.versions.set("excel-web-16.00.js", versions.map((v) => ({ ...v, body: host(v.build) })));
}

vi.mock("../src/crawler/fetcher.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchFile: vi.fn(async (url, conditional = {}) => {
    const file = url.replace(/^https:\/\/[^/]+\/(lib\/)?(1|beta)\/(hosted\/)?/, "");
    const versions = cdn.versions.get(file);
    if (!versions) return { httpStatus: 404, notModified: false, body: null, sha256: null, edgeIp: "9.9.9.9" };
    const n = cdn.turn.get(file) ?? 0;
    cdn.turn.set(file, n + 1);
    const v = versions[n % versions.length];
    const edgeIp = `10.0.0.${n % 8}`;
    if (conditional.lastModified && Date.parse(v.lastModified) <= Date.parse(conditional.lastModified)) {
      return { httpStatus: 304, notModified: true, body: null, sha256: null, lastModified: v.lastModified, edgeIp };
    }
    const body = Buffer.from(v.body);
    const sha256 = createHash("sha256").update(body).digest("hex");
    return { httpStatus: 200, notModified: false, body, sha256, lastModified: v.lastModified, edgeIp, wireBytes: body.length };
  }),
}));
vi.mock("../src/analysis/surface-runner.js", () => ({
  extractSurfaceIsolated: vi.fn(async () => ({ surface: {}, error: null })),
}));

let mongo;
let dir;
let runChannel;
let archive;
let db;
let closeDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  dir = mkdtempSync(path.join(tmpdir(), "silentship-bootstrap-"));
  Object.assign(process.env, {
    MONGODB_URI: mongo.getUri(),
    MONGODB_DB: "bootstrap-test",
    REGION: "test",
    CHANNELS: "prod,beta,onecdn-prod,onecdn-beta",
    SAMPLES: "4",
    ARCHIVE_DIR: path.join(dir, "archive"),
  });
  ({ runChannel } = await import("../src/pipeline/run.js"));
  ({ db, closeDb } = await import("../src/db.js"));
  const { GitArchive } = await import("../src/archive/git-archive.js");
  archive = new GitArchive(process.env.ARCHIVE_DIR);
  await archive.init();
}, 60_000);

afterAll(async () => {
  await closeDb();
  await mongo?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const stableOf = async (channel, file) => (await (await db()).fileStates.findOne({ channel, path: file }))?.stableBuild;
const rolloutsOf = async (channel) => (await db()).rollouts.find({ channel }).toArray();
const lastRun = async (channel) => (await db()).runs.findOne({ channel }, { sort: { startedAt: -1 } });

describe("bootstrap", () => {
  it("a new channel records what the CDN serves, newest version as stable, without rollouts", async () => {
    serve(OLD, NEW); // mid-rollout when the channel is added
    await runChannel("onecdn-prod", archive);
    expect(await lastRun("onecdn-prod")).toMatchObject({ status: "ok", bootstrap: true, created: 0 });
    expect(await rolloutsOf("onecdn-prod")).toEqual([]);
    expect(await stableOf("onecdn-prod", "office.js")).toBe(NEW.build);
    expect(await stableOf("onecdn-prod", "excel-web-16.00.js")).toBe(NEW.build);

    // Edges still on the older version are stale, never a rollout.
    await runChannel("onecdn-prod", archive);
    expect(await lastRun("onecdn-prod")).toMatchObject({ bootstrap: false, created: 0 });
    expect(await rolloutsOf("onecdn-prod")).toEqual([]);
  });

  it("a channel that has a stable version is never re-baselined, also after a restart", async () => {
    serve(OLD);
    await runChannel("prod", archive);
    expect(await lastRun("prod")).toMatchObject({ bootstrap: true });
    expect(await stableOf("prod", "office.js")).toBe(OLD.build);

    // A restart: a new connection, state read back from the database.
    await closeDb();
    serve(OLD, NEW);
    await runChannel("prod", archive);
    expect(await lastRun("prod")).toMatchObject({ status: "ok", bootstrap: false });
    expect(await stableOf("prod", "office.js")).toBe(OLD.build);
    const created = await rolloutsOf("prod");
    expect(created.map((r) => [r.path, r.fromBuild, r.toBuild, r.status]).sort()).toEqual([
      ["excel-web-16.00.js", OLD.build, NEW.build, "rolling"],
      ["office.js", OLD.build, NEW.build, "rolling"],
    ]);
  });
});
