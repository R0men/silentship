import { describe, expect, it } from "vitest";
import { highlights, releaseSummary, severityPhrase } from "../../frontend/lib/format.js";

/** Texts the site generates from release data (frontend/lib/format.js has no imports, so it runs here). */
const release = (o) => ({
  channel: "prod",
  group: "16.0.9.1",
  toBuild: "16.0.9.1",
  status: "rolling",
  share: 0.04,
  firstSeenAt: "2026-10-26T18:50:00.134Z",
  severity: "low",
  uniqueApiChanges: 0,
  apiChanges: [],
  ...o,
});
const change = (type, kind, severity, apiStatus = "ga") => ({ type, path: `${type}.x${Math.random()}`, kind, severity, apiStatus });

describe("release page summary", () => {
  it("says what rolls out where and since when", () => {
    expect(releaseSummary(release({})).lead).toBe(
      "Office.js build 16.0.9.1 is rolling out to the production CDN (first seen 26 Oct 2026, 18:50 UTC, 4% of sampled edges).",
    );
    expect(releaseSummary(release({ status: "complete", channel: "beta" })).lead).toContain(
      "rolled out to the beta CDN (first seen 26 Oct 2026, 18:50 UTC, 100% of sampled edges)",
    );
  });

  it("gives a verdict by severity, with the biggest High changes", () => {
    expect(releaseSummary(release({})).verdict).toBe("No public API changes. This build doesn't change any documented API.");
    const preview = [change("Excel.Foo", "added", "low", "preview")];
    expect(releaseSummary(release({ uniqueApiChanges: 1, apiChanges: preview })).verdict).toBe(
      "Only preview or undocumented APIs changed.",
    );
    const removed = [
      ...Array.from({ length: 8 }, () => change("Word.LineFormat", "removed", "high")),
      change("Excel.Range", "arityChanged", "high"),
      change("Excel.Range", "bodyChanged", "medium"),
    ];
    const s = releaseSummary(release({ severity: "high", uniqueApiChanges: 10, apiChanges: removed }));
    expect(s.verdict).toBe("Documented API changed: 10 changes. See the list below.");
    expect(s.highlights).toEqual(["Word.LineFormat: 8 members removed", "Excel.Range: 1 member with new parameters"]);
    expect(highlights(removed, 1)).toEqual(["Word.LineFormat: 8 members removed"]);
  });

  it("names severity in the home headline", () => {
    expect(severityPhrase({ severity: "high", uniqueApiChanges: 12 })).toBe("high-severity API changes");
    expect(severityPhrase({ severity: "high", uniqueApiChanges: 0 })).toBe("high severity");
    expect(severityPhrase({ severity: "low", uniqueApiChanges: 3 })).toBe("no breaking API changes");
    expect(severityPhrase({ severity: "low", uniqueApiChanges: 0 })).toBe("no public API changes");
  });
});
