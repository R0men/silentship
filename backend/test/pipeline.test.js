import { describe, expect, it } from "vitest";
import { matchesWatch, matchingChanges } from "../src/analysis/watchlist.js";
import { parseAkamaiRequestBc, extractMeta } from "../src/crawler/fetcher.js";
import { esc, html } from "../src/util/html.js";

describe("watchlist", () => {
  const w = (pattern, hosts = []) => ({ pattern, hosts });

  it("matches exact paths case-insensitively", () => {
    expect(matchesWatch(w("Excel.Range.getCell"), { path: "excel.range.getcell" })).toBe(true);
    expect(matchesWatch(w("Excel.Range.getCell"), { path: "Excel.Range.getCellProperties" })).toBe(false);
  });

  it("matches wildcards", () => {
    expect(matchesWatch(w("Excel.Range.*"), { path: "Excel.Range.clear" })).toBe(true);
    expect(matchesWatch(w("Excel.Range.*"), { path: "Excel.RangeFormat.clear" })).toBe(false);
  });

  it("matches removed or reshaped ancestors only", () => {
    expect(matchesWatch(w("Excel.Range.clear"), { path: "Excel.Range", kind: "removed" })).toBe(true);
    expect(matchesWatch(w("Excel.Range.clear"), { path: "Excel.Range", kind: "bodyChanged" })).toBe(false);
  });

  it("maps DDA method names to watched Office APIs", () => {
    expect(
      matchesWatch(w("Office.context.ui.displayDialogAsync"), { path: "OSF.DDA.AsyncMethodNames.DisplayDialogAsync" }),
    ).toBe(true);
  });

  it("filters by host", () => {
    expect(matchesWatch(w("Excel.Range.*", ["excel"]), { path: "Excel.Range.clear", hostType: "word" })).toBe(false);
    expect(matchesWatch(w("Excel.Range.*", ["excel"]), { path: "Excel.Range.clear", hostType: "excel" })).toBe(true);
  });

  it("passes everything through with an empty watchlist", () => {
    expect(matchingChanges([], [{ path: "x" }])).toHaveLength(1);
  });
});

describe("HTTP metadata", () => {
  it("parses Akamai-Request-BC", () => {
    expect(parseAkamaiRequestBc("[a=184.84.216.155,b=93532222,c=g,n=DE_HE_FRANKFURT,o=20940]")).toEqual({
      ip: "184.84.216.155",
      location: "DE_HE_FRANKFURT",
    });
    expect(parseAkamaiRequestBc(null)).toEqual({ ip: null, location: null });
  });

  it("extracts cache headers", () => {
    const meta = extractMeta(
      200,
      new Headers({
        "last-modified": "Fri, 09 Oct 2026 00:19:30 GMT",
        age: "12",
        "x-cdn-provider": "Akamai",
        "akamai-cache-status": "Hit from child",
      }),
    );
    expect(meta).toMatchObject({
      lastModified: "Fri, 09 Oct 2026 00:19:30 GMT",
      age: 12,
      cdnProvider: "Akamai",
      cacheStatus: "Hit from child",
    });
  });
});

describe("html", () => {
  it("escapes interpolations but not nested templates", () => {
    expect(html`<b>${"<x>"}</b>${html`<i>${"&"}</i>`}`.value).toBe("<b>&lt;x&gt;</b><i>&amp;</i>");
    expect(esc(`"'`)).toBe("&quot;&#39;");
  });
});

describe("rollout groups", async () => {
  const { groupKey } = await import("../src/pipeline/run.js");

  it("groups a build by its stamp and a removal per file", () => {
    expect(groupKey({ toBuild: "16.0.2", toSha: "b" })).toBe("16.0.2");
    const gone = { toBuild: null, toSha: null, fromBuild: "16.0.1" };
    expect(groupKey({ ...gone, path: "onenote-winrt-16.00.js" })).toBe("removed-16.0.1-onenote-winrt-16.00.js");
    expect(groupKey({ ...gone, path: "en-us/excel_strings.js" })).toBe("removed-16.0.1-en-us_excel_strings.js");
    expect(groupKey({ ...gone, path: "x".repeat(200) })).toMatch(/^[\w.-]{1,80}$/);
  });
});

describe("alert rules", async () => {
  const { emailWorthy, groupConfirmed, groupRolledBack } = await import("../src/notify/alerts.js");
  const at = (i) => new Date(Date.UTC(2026, 9, 15, 16, i * 10));

  it("does not alert on a version seen in a single run", () => {
    const blip = {
      status: "rolling",
      history: [
        { at: at(0), share: 0.625 },
        { at: at(1), share: 0 },
        { at: at(2), share: 0 },
      ],
    };
    expect(groupConfirmed([blip])).toBe(false);
  });

  it("alerts once any file was seen in two runs, or completed", () => {
    const seenTwice = {
      status: "rolling",
      history: [
        { at: at(0), share: 0.125 },
        { at: at(1), share: 0 },
        { at: at(2), share: 0.25 },
      ],
    };
    expect(groupConfirmed([{ status: "rolling", history: [{ at: at(0), share: 0.5 }] }, seenTwice])).toBe(true);
    expect(groupConfirmed([{ status: "complete", history: [] }])).toBe(true);
  });

  it("emails only rollouts that changed the API, or high severity", () => {
    expect(emailWorthy({ changes: [], severity: "low" })).toBe(false);
    expect(emailWorthy({ changes: [{ path: "Excel.Range" }], severity: "low" })).toBe(true);
    expect(emailWorthy({ changes: [], severity: "high" })).toBe(true);
  });

  it("treats a confirmed build that every edge stopped serving as a rollback", () => {
    const pulled = {
      status: "abandoned",
      history: [
        { at: at(0), share: 0.25 },
        { at: at(1), share: 0.5 },
        { at: at(2), share: 0 },
      ],
    };
    const blip = {
      status: "abandoned",
      history: [
        { at: at(0), share: 0.625 },
        { at: at(1), share: 0 },
      ],
    };
    expect(groupRolledBack([pulled, { ...pulled }])).toBe(true);
    expect(groupRolledBack([blip])).toBe(false);
    expect(groupRolledBack([pulled, { ...pulled, status: "complete" }])).toBe(false);
    expect(groupRolledBack([])).toBe(false);
  });
});
