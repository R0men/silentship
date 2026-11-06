import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ensureTtlIndex } from "../src/db.js";
import { createRunCache } from "../src/web/run-cache.js";

/** What keeps the service inside the database's free tier: a shorter TTL, and fewer queries per page. */
let mongo;
let client;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
});

describe("ensureTtlIndex", () => {
  const ttl = async (c) => (await c.indexes()).find((i) => i.key.fetchedAt)?.expireAfterSeconds;

  it("changes the age of an existing index instead of failing the start of the service", async () => {
    const c = client.db("t").collection("snapshots");
    await c.createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 90 * 86400 });
    await ensureTtlIndex(c, "fetchedAt", 30 * 86400);
    expect(await ttl(c)).toBe(30 * 86400);
  });

  it("creates it on a new database and is idempotent", async () => {
    const c = client.db("t").collection("fresh");
    await ensureTtlIndex(c, "fetchedAt", 30 * 86400);
    await ensureTtlIndex(c, "fetchedAt", 30 * 86400);
    expect(await ttl(c)).toBe(30 * 86400);
  });
});

describe("run cache", () => {
  it("builds once per version and shares a build between concurrent requests", async () => {
    let version = "a";
    const cached = createRunCache(() => version);
    const build = vi.fn(async () => "value");
    expect(await Promise.all([cached("k", build), cached("k", build)])).toEqual(["value", "value"]);
    expect(build).toHaveBeenCalledTimes(1);
    version = "b";
    await cached("k", build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("caches nothing before the feed knows a version", async () => {
    const cached = createRunCache(() => null);
    const build = vi.fn(async () => 1);
    await cached("k", build);
    await cached("k", build);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed build", async () => {
    const cached = createRunCache(() => "a");
    const build = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue("ok");
    await expect(cached("k", build)).rejects.toThrow("db down");
    expect(await cached("k", build)).toBe("ok");
  });

  it("stays bounded under requests for unknown URLs", async () => {
    const cached = createRunCache(() => "a", 3);
    const first = vi.fn(async () => 1);
    await cached("first", first);
    for (const k of ["b", "c", "d"]) await cached(k, async () => null);
    await cached("first", first);
    expect(first).toHaveBeenCalledTimes(2);
  });
});
