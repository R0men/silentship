import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

/** The crawl lock and the one-rolling-rollout index, against an in-memory MongoDB (.env is never used). */
let mongo;
let m;
let c;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "lock-test";
  m = await import("../src/db.js");
  c = await m.db();
});

afterAll(async () => {
  await m.closeDb();
  await mongo.stop();
});

describe("acquireLock", () => {
  it("is taken, renewed by its owner and released", async () => {
    expect(await m.acquireLock("crawl", 60_000)).toBe(true);
    expect(await m.acquireLock("crawl", 60_000)).toBe(true);
    await m.releaseLock("crawl");
    expect(await c.locks.countDocuments({ _id: "crawl" })).toBe(0);
  });

  it("refuses while another process holds it, and takes it once that expires", async () => {
    await c.locks.insertOne({ _id: "crawl", owner: "other-host:1:x", expiresAt: new Date(Date.now() + 60_000) });
    expect(await m.acquireLock("crawl", 60_000)).toBe(false);
    await m.releaseLock("crawl");
    expect((await c.locks.findOne({ _id: "crawl" })).owner).toBe("other-host:1:x");

    await c.locks.updateOne({ _id: "crawl" }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await m.acquireLock("crawl", 60_000)).toBe(true);
    await m.releaseLock("crawl");
  });
});

describe("one rolling rollout per version", () => {
  const doc = (o) => ({ channel: "prod", region: "eu", path: "word-win32-16.01.js", toSha: "s1", ...o });

  it("rejects a second rolling rollout of the same file version", async () => {
    await c.rollouts.insertOne(doc({ status: "rolling" }));
    await expect(c.rollouts.insertOne(doc({ status: "rolling" }))).rejects.toMatchObject({ code: 11000 });
  });

  it("allows finished duplicates and other versions", async () => {
    await c.rollouts.insertOne(doc({ status: "abandoned" }));
    await c.rollouts.insertOne(doc({ status: "complete" }));
    await c.rollouts.insertOne(doc({ status: "rolling", toSha: "s2" }));
    expect(await c.rollouts.countDocuments({ path: "word-win32-16.01.js" })).toBe(4);
  });
});
