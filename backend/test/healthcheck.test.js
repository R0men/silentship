import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pingHealthcheck } from "../src/notify/healthcheck.js";

/** The dead-man's switch ping against a local HTTP server standing in for healthchecks.io. */
let server;
let base;
const hits = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url.startsWith("/slow")) return; // never answers
    res.statusCode = req.url.startsWith("/broken") ? 500 : 200;
    res.end("OK");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("healthcheck ping", () => {
  it("pings the URL after a good crawl and <url>/fail after a failed one", async () => {
    hits.length = 0;
    expect(await pingHealthcheck(false, { url: `${base}/abc` })).toBe(true);
    expect(await pingHealthcheck(true, { url: `${base}/abc` })).toBe(true);
    expect(hits).toEqual(["/abc", "/abc/fail"]);
  });

  it("never throws: no URL, an error status or a timeout are only logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await pingHealthcheck(false, { url: "" })).toBe(false);
    expect(await pingHealthcheck(false, { url: `${base}/broken` })).toBe(false);
    expect(await pingHealthcheck(false, { url: `${base}/slow`, timeoutMs: 200 })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
