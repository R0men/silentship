import { describe, expect, it } from "vitest";
import { ABANDON_MS, COMPLETE_RUNS, isNewer, planFile, tallySamples } from "../src/pipeline/rollouts.js";
import { compareBuilds, extractBuild } from "../src/crawler/build.js";

const OLD = { sha: "old", build: "16.0.20528.15060", lastModified: "Fri, 09 Oct 2026 00:18:42 GMT" };
const NEW = { sha: "new", build: "16.0.20606.15070", lastModified: "Tue, 13 Oct 2026 21:05:39 GMT" };
const STALE = { sha: "stale", build: "16.0.20410.15200", lastModified: "Wed, 07 Oct 2026 23:55:00 GMT" };

const ok = (v, edgeIp = "1.1.1.1") => ({
  httpStatus: 200,
  notModified: false,
  sha256: v.sha,
  build: v.build,
  lastModified: v.lastModified,
  body: Buffer.from(v.sha),
  edgeIp,
});
const notModified = { httpStatus: 304, notModified: true, edgeIp: "2.2.2.2" };
const missing = { httpStatus: 404, notModified: false };
const stableState = { stableSha: OLD.sha, stableBuild: OLD.build, stableLM: OLD.lastModified, retiredShas: [] };
const now = new Date("2026-10-14T20:00:00Z");

function run(state, results, rollouts = [], at = now) {
  return planFile({ state, tally: tallySamples(results, state), rollouts, now: at });
}

describe("extractBuild", () => {
  it("reads every known marker", () => {
    expect(extractBuild("/* osfweb version: 16.0.20410.15200 */ min='16.0.17215.10000'")).toBe("16.0.20410.15200");
    expect(extractBuild("// osfweb: 16.0\\16.0.1.1\n// host: 16.0\\16.0.20528.15060\n")).toBe("16.0.20528.15060");
    expect(extractBuild('t.hostJSVersion="16.0.20606.15070",x')).toBe("16.0.20606.15070");
    expect(extractBuild('{FileVersion:"16.0.20528.15060",OfficeJS:"office.js"}')).toBe("16.0.20528.15060");
  });

  it("falls back to the newest stamp and ignores placeholders", () => {
    expect(extractBuild('a="16.0.0000.0000";b="16.0.17215.10000";c="16.0.20410.15200"')).toBe("16.0.20410.15200");
    expect(extractBuild("var strings = {}")).toBeNull();
  });

  it("orders builds numerically", () => {
    expect(compareBuilds("16.0.20606.15070", "16.0.20528.15060")).toBeGreaterThan(0);
    expect(compareBuilds("16.0.9999.1", "16.0.20528.1")).toBeLessThan(0);
  });
});

describe("tallySamples", () => {
  it("attributes 304s to the stable version and counts shares", () => {
    const t = tallySamples([notModified, notModified, ok(NEW), { error: new Error("x") }, missing], stableState);
    expect(t.samples).toBe(4);
    expect(t.errors).toBe(1);
    expect(t.variants.get("old").count).toBe(2);
    expect(t.variants.get("new").count).toBe(1);
    expect(t.variants.get("absent").count).toBe(1);
  });

  it("ignores 5xx", () => {
    expect(tallySamples([{ httpStatus: 503 }], stableState).samples).toBe(0);
  });
});

describe("planFile", () => {
  it("baseline: the oldest version is stable, a newer one is already a rollout", () => {
    const { state, creates } = run(null, [ok(OLD), ok(OLD), ok(OLD), ok(NEW)]);
    expect(state.stableSha).toBe("old");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ fromBuild: OLD.build, toBuild: NEW.build, share: 0.25 });
  });

  it("bootstrap of a new channel: the newest version is the baseline and nothing is a rollout", () => {
    const first = planFile({
      state: null,
      tally: tallySamples([ok(OLD), ok(OLD), ok(NEW), missing], null),
      rollouts: [],
      now,
      bootstrap: true,
    });
    expect(first.state).toMatchObject({ stableSha: "new", stableBuild: NEW.build, stableLM: NEW.lastModified });
    expect(first.creates).toEqual([]);
    expect(first.updates).toEqual([]);
    expect(first.stale).toBe(3);

    // Next run: edges still on the older version answer 304 (or send it) and stay stale, not a rollout.
    const second = run(first.state, [notModified, ok(OLD), notModified]);
    expect(second.creates).toEqual([]);
    expect(second.stale).toBe(1);
  });

  it("baseline of a file that does not exist", () => {
    const { state, creates } = run(null, [missing, missing]);
    expect(state.stableSha).toBeNull();
    expect(creates).toEqual([]);
  });

  it("starts a rollout when a newer version appears", () => {
    const { creates, state } = run(stableState, [notModified, notModified, notModified, ok(NEW)]);
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ fromSha: "old", toSha: "new", share: 0.25 });
    expect(creates[0].body).toBeInstanceOf(Buffer);
    expect(state.stableSha).toBe("old");
  });

  it("updates the share of a running rollout instead of creating a new one", () => {
    const rollout = { _id: "r1", toSha: "new", toBuild: NEW.build, peakShare: 0.25, fullRuns: 0 };
    const { creates, updates } = run(stableState, [notModified, ok(NEW), ok(NEW), ok(NEW)], [rollout]);
    expect(creates).toEqual([]);
    expect(updates[0]).toMatchObject({ id: "r1", share: 0.75, peakShare: 0.75, status: "rolling" });
  });

  it(`completes after ${COMPLETE_RUNS} runs at 100% and promotes the new version`, () => {
    const rollout = { _id: "r1", toSha: "new", toBuild: NEW.build, toLastModified: NEW.lastModified, fullRuns: COMPLETE_RUNS - 1 };
    const { updates, state } = run(stableState, [ok(NEW), ok(NEW)], [rollout]);
    expect(updates[0]).toMatchObject({ status: "complete", completedAt: now });
    expect(state).toMatchObject({ stableSha: "new", stableBuild: NEW.build, retiredShas: ["old"] });
  });

  it("treats an older build from a lagging edge as stale, not a rollout", () => {
    const { creates, stale } = run(stableState, [notModified, ok(STALE)]);
    expect(creates).toEqual([]);
    expect(stale).toBe(1);
  });

  it("treats a retired version as stale", () => {
    const after = { stableSha: "new", stableBuild: NEW.build, stableLM: NEW.lastModified, retiredShas: ["old"] };
    expect(run(after, [ok(OLD), ok(NEW)]).stale).toBe(1);
  });

  it("tracks a file disappearing as a removal rollout", () => {
    const { creates } = run(stableState, [notModified, missing]);
    expect(creates[0]).toMatchObject({ fromSha: "old", toSha: null, share: 0.5 });
  });

  it("marks a rollout abandoned after a day without samples, and revives it if it returns", () => {
    const zeroSince = new Date(now.getTime() - ABANDON_MS);
    const rollout = { _id: "r1", toSha: "new", toBuild: NEW.build, zeroSince, peakShare: 0.3 };
    expect(run(stableState, [notModified], [rollout]).updates[0]).toMatchObject({ status: "abandoned", share: 0 });
    expect(run(stableState, [ok(NEW)], [{ ...rollout, status: "abandoned" }]).updates[0]).toMatchObject({
      status: "rolling",
      zeroSince: null,
    });
  });

  it("a rollout stuck at ~1% with long gaps stays rolling; a day on the old build everywhere is a pullback", () => {
    // Every 10 minutes for a day: 1 hit in 100 samples every 6 hours, otherwise the old build (304).
    const tick = 10 * 60_000;
    const quiet = Array(100).fill(notModified);
    const hit = [ok(NEW), ...Array(99).fill(notModified)];
    let rollout = { _id: "r1", toSha: "new", toBuild: NEW.build, history: [], peakShare: 0.01, zeroSince: null };
    const step = (results, at) => {
      const u = run(stableState, results, [rollout], at).updates[0];
      rollout = { ...rollout, ...u, history: [...rollout.history, { at, share: u.share }] };
      return u;
    };
    for (let i = 1; i <= 144; i++) {
      const u = step(i % 36 === 0 ? hit : quiet, new Date(now.getTime() + i * tick));
      expect(u.status).toBe("rolling");
    }
    expect(rollout.peakShare).toBe(0.01);

    // Rolled back: no edge serves the new build. Still rolling just under a day, pulled back at a day.
    const lastHit = rollout.lastSeenAt;
    const t = (ms) => new Date(lastHit.getTime() + ms);
    expect(step(quiet, t(tick)).status).toBe("rolling");
    expect(step(quiet, t(ABANDON_MS)).status).toBe("rolling"); // zeroSince is the first quiet run, a tick later
    expect(step(quiet, t(ABANDON_MS + tick))).toMatchObject({ status: "abandoned", share: 0, lastSeenAt: lastHit });
    // The stable version did not move: the old build is still what the file serves.
    expect(run(stableState, quiet, [rollout], t(ABANDON_MS + 2 * tick)).state.stableSha).toBe("old");
  });

  it("raises the conditional-request floor to the newest Last-Modified of stable content", () => {
    const sameBytesLaterDate = { ...OLD, lastModified: "Sat, 10 Oct 2026 10:00:00 GMT" };
    expect(run(stableState, [ok(sameBytesLaterDate)]).state.stableLM).toBe(sameBytesLaterDate.lastModified);
  });

  it("orders versions by build before Last-Modified", () => {
    expect(isNewer({ ...NEW, lastModified: OLD.lastModified }, { ...OLD, lastModified: NEW.lastModified })).toBe(true);
  });
});

describe("smoothedShare", () => {
  it("averages the last runs so single-run sampling noise does not swing the display", async () => {
    const { smoothedShare } = await import("../src/pipeline/rollouts.js");
    const history = [0.25, 0, 0.125, 0.125, 0.25, 0, 0.5].map((share) => ({ share }));
    expect(smoothedShare(history, 0.125)).toBeCloseTo((0.125 + 0.125 + 0.25 + 0 + 0.5 + 0.125) / 6);
    expect(smoothedShare([], 0.5)).toBe(0.5);
  });
});

describe("classify", () => {
  it("demotes preview and undocumented API changes, keeps GA severity, and tags requirement sets", async () => {
    const { classifyChanges } = await import("../src/analysis/classify.js");
    const status = (p) =>
      ({
        "Excel.Range.getCell": { status: "ga", apiSet: "ExcelApi 1.1" },
        "Excel.SensitivityLabelAbacAttribute": { status: "preview", apiSet: "ExcelApi BETA (PREVIEW ONLY)" },
      })[p] ?? { status: "undocumented", apiSet: null };
    const out = classifyChanges(
      [
        { path: "Excel.Range.getCell", kind: "removed", severity: "high" },
        { path: "Excel.SensitivityLabelAbacAttribute", kind: "removed", severity: "high" },
        { path: "Excel.initialize", kind: "arityChanged", severity: "high" },
      ],
      status,
    );
    expect(out.map((c) => [c.severity, c.apiStatus, c.apiSet])).toEqual([
      ["high", "ga", "ExcelApi 1.1"],
      ["low", "preview", "ExcelApi BETA (PREVIEW ONLY)"],
      ["low", "undocumented", null],
    ]);
  });

  it("lowers a GA change one level where its requirement set is not production on the file's platform", async () => {
    const { classifyChanges, rolloutNote } = await import("../src/analysis/classify.js");
    const status = (p) =>
      ({
        "Word.LineFormat.beginArrowheadStyle": { status: "ga", apiSet: "WordApiDesktop 1.3" },
        "Word.LineFormat.weight": { status: "ga", apiSet: "WordApiDesktop 1.3" },
        "Word.Body.getRange": { status: "ga", apiSet: "WordApiOnline 1.1" },
        "Excel.Range.getCell": { status: "ga", apiSet: "ExcelApi 1.19" },
      })[p];
    const removed = (path) => ({ path, kind: "removed", severity: "high" });
    const sev = (changes, platform) => classifyChanges(changes, status, platform).map((c) => c.severity);

    expect(sev([removed("Word.LineFormat.beginArrowheadStyle")], "win32")).toEqual(["high"]);
    expect(sev([removed("Word.LineFormat.beginArrowheadStyle")], "Mac")).toEqual(["high"]);
    expect(sev([removed("Word.LineFormat.beginArrowheadStyle")], "ios")).toEqual(["medium"]);
    expect(sev([{ path: "Word.LineFormat.weight", kind: "bodyChanged", severity: "medium" }], "web")).toEqual(["low"]);
    expect(sev([removed("Word.Body.getRange")], "web")).toEqual(["high"]);
    expect(sev([removed("Word.Body.getRange")], "win32")).toEqual(["medium"]);
    expect(sev([removed("Excel.Range.getCell")], "ios")).toEqual(["high"]);
    // No platform (office.js and other non-host files): nothing to compare, nothing lowered.
    expect(sev([removed("Word.LineFormat.beginArrowheadStyle")], null)).toEqual(["high"]);

    const out = classifyChanges(
      [removed("Word.LineFormat.beginArrowheadStyle"), removed("Word.LineFormat.weight"), removed("Excel.Range.getCell")],
      status,
      "ios",
    );
    expect(out.map((c) => c.gaOnPlatform)).toEqual([false, false, true]);
    expect(rolloutNote(null, out)).toBe("WordApiDesktop 1.3 is not GA on ios");
    expect(rolloutNote("new side failed", [])).toBe("new side failed");
  });

  it("turns a removed+added pair into a rename, judged by the old name's status", async () => {
    const { postProcess } = await import("../src/analysis/classify.js");
    const enumOf = (values) => ({ kind: "enum", values });
    const changes = [
      { path: "Excel.SensitivityLabelUpdateResult", kind: "removed", severity: "high", before: enumOf({ a: "A" }) },
      { path: "Excel.SensitivityLabelUpdateStatus", kind: "added", severity: "low", after: enumOf({ b: "B" }) },
      { path: "Excel.Table.getItem", kind: "removed", severity: "high", before: { kind: "function" } },
      { path: "Excel.Table.getItemAt", kind: "added", severity: "low", after: { kind: "function" } },
    ];
    const status = (p) => (p.includes("Sensitivity") ? { status: "preview" } : { status: "ga" });
    const out = postProcess(changes, status);
    const renamed = out.find((c) => c.kind === "renamed");
    expect(renamed).toMatchObject({
      path: "Excel.SensitivityLabelUpdateStatus",
      from: "Excel.SensitivityLabelUpdateResult",
      severity: "low",
      apiStatus: "preview",
    });
    // getItem -> getItemAt are different methods: not merged.
    expect(out.filter((c) => c.path.startsWith("Excel.Table")).map((c) => c.kind).sort()).toEqual(["added", "removed"]);
  });

  it("treats enums with identical values as a rename whatever the name", async () => {
    const { detectRenames } = await import("../src/analysis/classify.js");
    const values = { a: "A", b: "B" };
    const out = detectRenames([
      { path: "Word.Foo", kind: "removed", severity: "high", before: { kind: "enum", values } },
      { path: "Word.TotallyDifferent", kind: "added", severity: "low", after: { kind: "enum", values } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "renamed", from: "Word.Foo" });
  });

  it("knows real Office.js APIs from the official type definitions", async () => {
    const { apiStatus } = await import("../src/analysis/api-catalog.js");
    expect(apiStatus("Excel.Range.getCell")).toEqual({ status: "ga", apiSet: "ExcelApi 1.1" });
    expect(apiStatus("Excel.SensitivityLabelAbacAttribute").status).toBe("preview");
    expect(apiStatus("Excel.Range.notARealMember").status).toBe("undocumented");
  });
});
