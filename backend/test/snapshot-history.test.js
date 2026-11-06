import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { readSnapshots } from "../src/archive/snapshot-history.js";

let mongo;
let client;
let snapshots;
let dir;

const ID = {
  fileOnly: "65f000000000000000000001",
  both: "65f000000000000000000002",
  mongoOnly: "65f000000000000000000003",
  otherFile: "65f000000000000000000004",
  otherDay: "65f000000000000000000005",
};

/** One line as mongoexport writes it: extended JSON, $oid and $date. */
const line = (id, at, file = "onenote-winrt-16.00.js") =>
  JSON.stringify({ _id: { $oid: id }, channel: "prod", region: "eu", path: file, fetchedAt: { $date: at }, samples: 8, errors: 5 });

const doc = (id, at, file = "onenote-winrt-16.00.js") => ({
  _id: new ObjectId(id),
  channel: "prod",
  region: "eu",
  path: file,
  fetchedAt: new Date(at),
  samples: 8,
  errors: 5,
});

const writeDay = (day, lines) => writeFileSync(path.join(dir, `${day}.jsonl.gz`), gzipSync(lines.map((l) => `${l}\n`).join("")));

const range = { from: new Date("2026-10-15T00:00:00Z"), to: new Date("2026-10-17T00:00:00Z") };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  dir = mkdtempSync(path.join(tmpdir(), "snapshot-history-"));
});

afterAll(async () => {
  await client?.close();
  await mongo?.stop();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  snapshots = client.db("t").collection("snapshots");
  await snapshots.deleteMany({});
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
});

describe("readSnapshots", () => {
  it("reads a row MongoDB has already deleted from its day's file, with real dates and ids", async () => {
    writeDay("2026-10-15", [line(ID.fileOnly, "2026-10-15T16:16:00Z")]);
    const [row] = await readSnapshots(range, { snapshots, dir });
    expect(row._id).toBeInstanceOf(ObjectId);
    expect(row.fetchedAt).toEqual(new Date("2026-10-15T16:16:00Z"));
    expect(row.errors).toBe(5);
  });

  it("joins both sources, counts a row in both once, oldest first", async () => {
    writeDay("2026-10-15", [line(ID.fileOnly, "2026-10-15T16:16:00Z"), line(ID.both, "2026-10-15T18:00:00Z")]);
    await snapshots.insertMany([doc(ID.both, "2026-10-15T18:00:00Z"), doc(ID.mongoOnly, "2026-10-16T09:00:00Z")]);
    const rows = await readSnapshots(range, { snapshots, dir });
    expect(rows.map((r) => String(r._id))).toEqual([ID.fileOnly, ID.both, ID.mongoOnly]);
  });

  it("applies the same filter and range to files as to MongoDB", async () => {
    writeDay("2026-10-15", [line(ID.fileOnly, "2026-10-15T16:16:00Z"), line(ID.otherFile, "2026-10-15T16:16:00Z", "excel-win32-16.01.js")]);
    writeDay("2026-10-17", [line(ID.otherDay, "2026-10-17T00:00:00Z")]);
    const rows = await readSnapshots(
      { ...range, to: new Date("2026-10-18T00:00:00Z"), channel: "prod", region: "eu", path: "onenote-winrt-16.00.js" },
      { snapshots, dir },
    );
    expect(rows.map((r) => String(r._id))).toEqual([ID.fileOnly, ID.otherDay]);
    const narrow = await readSnapshots({ ...range, path: "onenote-winrt-16.00.js" }, { snapshots, dir });
    expect(narrow.map((r) => String(r._id))).toEqual([ID.fileOnly]);
  });

  it("treats a day without a file as a day without rows", async () => {
    expect(await readSnapshots(range, { snapshots, dir })).toEqual([]);
  });

  it("fails on a damaged file instead of returning part of a day as if it were all of it", async () => {
    writeFileSync(path.join(dir, "2026-10-15.jsonl.gz"), "not gzip");
    await expect(readSnapshots(range, { snapshots, dir })).rejects.toThrow();
  });
});
