import { describe, expect, it } from "vitest";
import { extractSurface } from "../src/analysis/surface.js";
import { diffReflections, diffSurfaces } from "../src/analysis/diff.js";

// Shape of metadata-driven builds (16.0.20606+): every class is a generic stub that builds its
// prototype from metadata on first instantiation; every method is the same generated wrapper.
const LAZY = `
var Excel = {};
(function () {
  var meta = {
    Range: [["getCell", 2], ["clear", 1], ["select", 0], ["merge", 1]],
    Worksheet: [["getRange", 1], ["activate", 0], ["delete", 0]],
  };
  function base() {}
  function wrapper(name) { return function () { return [name].concat([].slice.call(arguments)); }; }
  function buildPrototype(cls, name) { meta[name].forEach(function (m) { cls.prototype[m[0]] = wrapper(m[0]); }); }
  Object.keys(meta).forEach(function (name) {
    var cls = function (ctx, path) { base.apply(this, arguments); cls._typeInited || (buildPrototype(cls, name), cls._typeInited = !0); };
    Excel[name] = cls;
  });
  Excel.Extra1 = function () {}; Excel.Extra2 = function () {}; Excel.Extra3 = function () {};
})();
`;

// The same API, written out by hand the old way.
const EAGER = `
var Excel = {};
(function () {
  function Range(ctx) { this.c = ctx; }
  Range.prototype.getCell = function (r, c) { return [r, c]; };
  Range.prototype.clear = function (o) { return o; };
  Range.prototype.select = function () { return 1; };
  Range.prototype.merge = function (a) { return a; };
  function Worksheet(ctx) { this.c = ctx; }
  Worksheet.prototype.getRange = function (a) { return a; };
  Worksheet.prototype.activate = function () { return 2; };
  Worksheet.prototype.delete = function () { return 3; };
  Excel.Range = Range; Excel.Worksheet = Worksheet;
  Excel.Extra1 = function () {}; Excel.Extra2 = function () {}; Excel.Extra3 = function () {};
})();
`;

describe("metadata-driven classes", () => {
  it("are materialized so their methods are visible", () => {
    const r = extractSurface([{ filename: "lazy.js", source: LAZY }]);
    expect(r.materialized).toBe(2);
    expect(r.surface["Excel.Range.getCell"]).toMatchObject({ kind: "function", generic: true });
    expect(r.surface["Excel.Worksheet.getRange"]).toBeDefined();
  });

  it("switching from hand-written to generated classes raises nothing above low", () => {
    const before = extractSurface([{ filename: "eager.js", source: EAGER }]).surface;
    const after = extractSurface([{ filename: "lazy.js", source: LAZY }]).surface;
    const changes = diffSurfaces(before, after);
    expect(changes.filter((c) => c.severity !== "low")).toEqual([]);
    expect(changes.some((c) => c.kind === "removed")).toBe(false);
  });
});

describe("diffReflections", () => {
  const fn = (arity) => ({ kind: "function", arity, bodyHash: `h${arity}` });
  const full = { "A.a": fn(1), "A.b": fn(1), "A.c": fn(1), "A.d": fn(1), "A.e": fn(1) };

  it("reports removals between two complete reflections", () => {
    const after = { ...full };
    delete after["A.e"];
    const { changes, note } = diffReflections({ surface: full, error: null }, { surface: after, error: null });
    expect(changes.map((c) => [c.path, c.kind, c.severity])).toEqual([["A.e", "removed", "high"]]);
    expect(note).toBeNull();
  });

  it("does not report removals when the new reflection failed", () => {
    const { changes, note } = diffReflections(
      { surface: full, error: null },
      { surface: { "A.a": fn(1) }, error: "abc.js: TypeError: x is undefined" },
    );
    expect(changes.filter((c) => c.kind === "removed")).toEqual([]);
    expect(note).toMatch(/could not be fully reflected/);
  });

  it("does not report removals when the surface silently shrank", () => {
    const { changes, note } = diffReflections({ surface: full, error: null }, { surface: { "A.a": fn(1) }, error: null });
    expect(changes).toEqual([]);
    expect(note).toMatch(/shrank from 5 to 1/);
  });

  it("trusts two reflections that failed the same way (file names aside)", () => {
    const sha = (c) => c.repeat(64);
    const after = { ...full };
    delete after["A.e"];
    const { changes, note } = diffReflections(
      { surface: full, error: `${sha("a")}: TypeError: boom` },
      { surface: after, error: `${sha("b")}: TypeError: boom` },
    );
    expect(changes.map((c) => c.kind)).toEqual(["removed"]);
    expect(note).toBeNull();
  });

  it("does not report additions when the old reflection was the incomplete one", () => {
    const { changes } = diffReflections(
      { surface: { "A.a": fn(1) }, error: "x: TypeError" },
      { surface: full, error: null },
    );
    expect(changes.filter((c) => c.kind === "added")).toEqual([]);
  });
});
