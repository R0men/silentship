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

