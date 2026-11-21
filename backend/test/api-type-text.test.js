import { describe, expect, it } from "vitest";
import { indexedType, metaDescription, pageTitle } from "../../frontend/lib/apiType.js";

/** Titles and descriptions of /reference/<type> pages: short enough for a search result, honest about channels. */
const event = (o) => ({
  channel: "prod",
  group: "16.0.20619.15190",
  toBuild: "16.0.20619.15190",
  status: "complete",
  share: 1,
  firstSeenAt: "2026-10-26T18:50:00.134Z",
  kind: "removed",
  path: "Word.LineFormat.backgroundColor",
  files: ["word-win32-16.01.js", "word-web-16.00.js", "word-mac-16.00.js"],
  pulledFiles: [],
  ...o,
});
const type = (o) => ({ type: "Word.LineFormat", docs: { status: "ga", apiSet: "WordApiDesktop 1.3" }, ...o });

describe("API type page text", () => {
  it("names production implicitly and beta explicitly", () => {
    expect(pageTitle(type({ events: [event({}), event({ channel: "beta" })] }))).toBe(
      "Word.LineFormat.backgroundColor removed in Office.js",
    );
    expect(pageTitle(type({ events: [event({ channel: "beta" })] }))).toBe(
      "Word.LineFormat.backgroundColor removed in Office.js beta",
    );
    expect(pageTitle(type({ docs: { status: "undocumented" }, events: [event({ channel: "beta", kind: "added" })] }))).toBe(
      "Word.LineFormat.backgroundColor added in Office.js beta (undocumented)",
    );
    expect(pageTitle(type({ events: [event({}), event({ path: "Word.LineFormat.pattern" })] }))).toBe(
      "Word.LineFormat: 2 API changes in Office.js",
    );
  });

  it("keeps the description within 160 characters, the change first", () => {
    const d = metaDescription(type({ events: [event({}), event({ path: "Word.LineFormat.pattern" })] }));
    expect(d.startsWith("Word.LineFormat (GA, WordApiDesktop 1.3): 2 API changes, latest backgroundColor removed in Office.js 16.0.20619.15190")).toBe(true);
    expect(d).toContain("Affects Word.");
    expect(d.length).toBeLessThanOrEqual(160);

    const long = metaDescription(
      type({
        type: "OfficeExtension.ClientRequestBase",
        docs: { status: "undocumented" },
        events: [
          event({
            channel: "beta",
            kind: "bodyChanged",
            path: "OfficeExtension.ClientRequestBase.buildRequestMessageBodyAndRequestFlags",
            files: ["excel-web-16.00.js", "word-web-16.00.js", "powerpoint-web-16.00.js", "onenote-web-16.00.js", "visio-web-16.00.js"],
          }),
        ],
      }),
    );
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long).toMatch(/^OfficeExtension\.ClientRequestBase \(undocumented\): buildRequestMessageBodyAndRequestFlags implementation changed in Office\.js 16\.0\.20619\.15190 beta/);
  });

  it("indexes every type but undocumented ones", () => {
    expect(indexedType("ga")).toBe(true);
    expect(indexedType("preview")).toBe(true);
    expect(indexedType(undefined)).toBe(true);
    expect(indexedType("undocumented")).toBe(false);
  });
});
