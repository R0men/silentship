import { describe, expect, it } from "vitest";
import { parseLoader } from "../src/crawler/loader.js";
import { buildManifest, hostFileName, versionsUpTo } from "../src/crawler/manifest.js";

// Shape mirrors the minified production loader; content is synthetic.
const LOADER = `
var OSF=OSF||{};OSF.HostSpecificFileVersionDefault="16.00";
OSF.HostSpecificFileVersionMap={excel:{web:"16.00",win32:"16.01"},outlook:{web:"16.01",win32:"16.02"},"project":{win32:"16.00"}};
(function(){var a={FileVersion:"16.0.11111.22222",OfficeJS:"office.js",OfficeStringJS:"office_strings.js",O15InitHelper:"o15apptofilemappingtable.js",LocaleStringLoadingTimeout:5e3,Flag:!0};
OSF.ConstantNames={FileVersion:"16.0.11111.22222",OfficeJS:"office.js"};
var t="telemetry/oteljs_agave.js";
OSF.ConstantNames={OfficeStringJS:"office_strings.js",O15InitHelper:"o15apptofilemappingtable.js"};})();
`;

describe("parseLoader", () => {
  const info = parseLoader(LOADER);

  it("extracts the build stamp", () => {
    expect(info.build).toBe("16.0.11111.22222");
  });

  it("extracts the host version map including quoted keys", () => {
    expect(info.hostMap).toEqual({
      excel: { web: "16.00", win32: "16.01" },
      outlook: { web: "16.01", win32: "16.02" },
      project: { win32: "16.00" },
    });
  });

  it("merges repeated ConstantNames assignments", () => {
    expect(info.constants.OfficeJS).toBe("office.js");
    expect(info.constants.O15InitHelper).toBe("o15apptofilemappingtable.js");
  });

  it("finds script references with a directory", () => {
    expect(info.scriptRefs).toEqual(["telemetry/oteljs_agave.js"]);
  });

  it("returns empty data for unrelated code", () => {
    const empty = parseLoader("var x = 1;");
    expect(empty.build).toBeNull();
    expect(empty.hostMap).toEqual({});
  });
});

describe("manifest", () => {
  it("expands versions up to the ceiling", () => {
    expect(versionsUpTo("16.00", "16.02")).toEqual(["16.00", "16.01", "16.02"]);
    expect(versionsUpTo("16.00", "16.00")).toEqual(["16.00"]);
    expect(versionsUpTo("16.05", "16.02")).toEqual(["16.02"]);
  });

  it("builds file names like the loader does", () => {
    expect(hostFileName("Excel", "Win32", "16.01")).toBe("excel-win32-16.01.js");
    expect(hostFileName("excel", "web", "16.00", "experiment")).toBe("excel-web-16.00-experiment.js");
  });

  it("lists loader, all host versions and dependencies", () => {
    const paths = buildManifest(parseLoader(LOADER), ["en-us"]).map((e) => e.path);
    expect(paths).toEqual([
      "en-us/office_strings.js",
      "excel-web-16.00.js",
      "excel-win32-16.00.js",
      "excel-win32-16.01.js",
      "microsoftajax.js",
      "o15apptofilemappingtable.js",
      "office.js",
      "outlook-web-16.00.js",
      "outlook-web-16.01.js",
      "outlook-win32-16.00.js",
      "outlook-win32-16.01.js",
      "outlook-win32-16.02.js",
      "project-win32-16.00.js",
      "telemetry/oteljs_agave.js",
    ]);
  });
});
