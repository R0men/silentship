import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractSurfaceIsolated, workerReason } from "../src/analysis/surface-runner.js";

/** The sandboxed worker on synthetic scripts: no CDN code in this test. */
const dir = mkdtempSync(path.join(tmpdir(), "surface-runner-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("surface worker", () => {
  it("survives a script whose promise rejects: a host call that has no host must not lose the surface", async () => {
    // As an Office.js loader does outside a real host: an async call into something the sandbox does not have.
    // The surface is big enough that writing it to the pipe takes several turns of the event loop.
    const members = Array.from({ length: 40_000 }, (_, i) => `m${i}:function(){}`).join(",");
    const file = path.join(dir, "rejects.js");
    writeFileSync(
      file,
      `var Office={${members}};\n` +
        `function later(n){return n?Promise.resolve().then(function(){return later(n-1)}):new Promise(function(){throw new TypeError("no host")})}\n` +
        `later(50);setTimeout(function(){},0);`,
    );
    for (let i = 0; i < 3; i++) {
      const { surface } = await extractSurfaceIsolated(file);
      expect(surface["Office.m39999"]).toMatchObject({ kind: "function" });
    }
  }, 120_000);
});

describe("workerReason", () => {
  const source = `var OfficeExt=function(){${"x".repeat(5000)}}`;

  it("keeps the error and leaves out the source line Node prints with it", () => {
    const stderr = [
      `${"a".repeat(64)}:25`,
      source,
      `${" ".repeat(400)}^`,
      "",
      "TypeError: Something.executeAsync is not a function",
      `    at i (${"a".repeat(64)}:25:441651)`,
      "",
      "Node.js v22.23.2",
    ].join("\n");
    const reason = workerReason(stderr);
    expect(reason).toContain("TypeError: Something.executeAsync is not a function");
    expect(reason).toContain(":25:441651");
    expect(reason).not.toContain("OfficeExt");
    expect(reason).not.toContain("xxxx");
    expect(reason.length).toBeLessThan(1000);
  });

  it("says so when there is nothing but source", () => {
    expect(workerReason(source)).toBe("no readable error");
  });
});
