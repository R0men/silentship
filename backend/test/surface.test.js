import { describe, expect, it } from "vitest";
import { normalizedSourceHash } from "../src/analysis/fn-hash.js";
import { extractSurface } from "../src/analysis/surface.js";
import { diffSurfaces } from "../src/analysis/diff.js";

describe("normalizedSourceHash", () => {
  it("ignores minifier renaming of variables", () => {
    const a = `function(e,t){return j("Range.getCell",S,"1.1",O),A(this.n,e+t)}`;
    const b = `function (x, y) { return q("Range.getCell", Z, "1.1", W), B(this.n, x + y) }`;
    expect(normalizedSourceHash(a)).toBe(normalizedSourceHash(b));
  });

  it("detects changed property names and literals", () => {
    const base = `function(e){return this.items.get(e,"1.1")}`;
    expect(normalizedSourceHash(base)).not.toBe(normalizedSourceHash(`function(e){return this.values.get(e,"1.1")}`));
    expect(normalizedSourceHash(base)).not.toBe(normalizedSourceHash(`function(e){return this.items.get(e,"1.2")}`));
  });

  it("handles method shorthand and accessors", () => {
    expect(normalizedSourceHash("getCell(a){return a}")).toBe(normalizedSourceHash("getCell(b){return b}"));
    expect(normalizedSourceHash("get x(){return this._x}")).toMatch(/^[0-9a-f]{64}$/);
  });
});

const HOST_V1 = `
var Excel;(function(n){
  var r=(function(){function t(e){this.c=e}
    t.prototype.getCell=function(e,o){return [e,o]};
    t.prototype.clear=function(e){return e};
    Object.defineProperty(t.prototype,"address",{get:function(){return "A1"},enumerable:!0,configurable:!0});
    t.prototype._internal=function(){};
    return t})();
  n.Range=r;
  n.BindingType={range:"Range",table:"Table",text:"Text"};
  n.Util={doThing:function(a){return a},version:3};
})(Excel||(Excel={}));
var Office={context:{},HostType:{Excel:"Excel"}};
document.createElement("script").setAttribute("x","y");
new HTMLScriptElement();
`;

describe("extractSurface", () => {
  const { surface, error } = extractSurface([{ filename: "excel-web-16.00.js", source: HOST_V1 }]);

  it("runs browser-flavoured code without errors", () => {
    expect(error).toBeNull();
  });

  it("reflects classes, members, enums and namespaces", () => {
    expect(surface["Excel"]).toEqual({ kind: "namespace" });
    expect(surface["Excel.Range"]).toMatchObject({ kind: "class", arity: 1 });
    expect(surface["Excel.Range.getCell"]).toMatchObject({ kind: "function", arity: 2 });
    expect(surface["Excel.Range.address"]).toEqual({ kind: "property", get: true, set: false });
    expect(surface["Excel.BindingType"]).toEqual({
      kind: "enum",
      values: { range: "Range", table: "Table", text: "Text" },
    });
    expect(surface["Excel.Util.version"]).toEqual({ kind: "value", type: "number" });
    expect(surface["Office.HostType"]).toEqual({ kind: "enum", values: { Excel: "Excel" } });
  });

  it("skips underscore-prefixed internals", () => {
    expect(Object.keys(surface).some((k) => k.includes("_internal"))).toBe(false);
  });

  it("produces a diff with the expected severities across builds", () => {
    const v2 = HOST_V1.replace("t.prototype.clear=function(e){return e};", "") // removed
      .replace("getCell=function(e,o){return [e,o]}", "getCell=function(e,o,i){return [e,o,i]}") // arity
      .replace('text:"Text"', 'text:"Txt",image:"Image"') // enum changed + added
      .replace("doThing:function(a){return a}", "doThing:function(b){return b+1}") // body
      .replace("version:3", "version:3,newApi:function(){}"); // added
    const after = extractSurface([{ filename: "v2.js", source: v2 }]).surface;
    const changes = diffSurfaces(surface, after);
    const byPath = Object.fromEntries(changes.map((c) => [c.path, [c.kind, c.severity]]));
    expect(byPath).toEqual({
      "Excel.Range.clear": ["removed", "high"],
      "Excel.Range.getCell": ["arityChanged", "high"],
      "Excel.BindingType": ["enumChanged", "high"],
      "Excel.Util.doThing": ["bodyChanged", "medium"],
      "Excel.Util.newApi": ["added", "low"],
    });
    expect(changes.find((c) => c.path === "Excel.BindingType").detail).toEqual({
      removed: [],
      changed: ["text"],
      added: ["image"],
    });
  });

  it("treats a minified-but-identical rebuild as unchanged", () => {
    const renamed = HOST_V1.replace(/function\(e,o\)\{return \[e,o\]\}/, "function(q,w){return [q,w]}");
    const after = extractSurface([{ filename: "v1b.js", source: renamed }]).surface;
    expect(diffSurfaces(surface, after)).toEqual([]);
  });
});

describe("diffSurfaces", () => {
  it("folds removals under a removed parent", () => {
    const changes = diffSurfaces(
      {
        A: { kind: "namespace" },
        "A.B": { kind: "function", arity: 0, bodyHash: "x" },
        "A.C": { kind: "value", type: "number" },
      },
      {},
    );
    expect(changes.map((c) => c.path)).toEqual(["A"]);
  });

  it("only flags lost accessors as high", () => {
    const [lost] = diffSurfaces(
      { p: { kind: "property", get: true, set: true } },
      { p: { kind: "property", get: true, set: false } },
    );
    const [gained] = diffSurfaces(
      { p: { kind: "property", get: true, set: false } },
      { p: { kind: "property", get: true, set: true } },
    );
    expect(lost.severity).toBe("high");
    expect(gained.severity).toBe("low");
  });
});
