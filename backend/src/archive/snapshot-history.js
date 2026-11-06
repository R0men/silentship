import { createReadStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { BSON } from "mongodb";
import { config } from "../config.js";
import { db } from "../db.js";

const DAY_MS = 24 * 3600_000;

/** Each UTC day that [from, to) touches, as YYYY-MM-DD. */
function daysBetween(from, to) {
  const days = [];
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let t = first; t < to.getTime(); t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** The rows of one day's file (deploy/backup.sh writes it with mongoexport); none if that day has no file. */
async function* readDay(dir, day) {
  const gunzip = createGunzip();
  const source = createReadStream(path.join(dir, `${day}.jsonl.gz`));
  // Forwarded so a missing file reaches the reader below through the line iterator.
  source.on("error", (err) => gunzip.destroy(err));
  const lines = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line) yield BSON.EJSON.parse(line);
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

/**
 * Per-run samples of [from, to), wherever they are now: MongoDB holds the last 30 days (TTL) and the daily files
 * of deploy/backup.sh hold what is older, so a caller never has to know when a row moved. A row in both counts once.
 * `channel`, `region` and `path` narrow the result when given. Oldest first.
 */
export async function readSnapshots(
  { channel, region, path: file, from, to },
  { snapshots, dir = path.join(config.backupDir, "snapshots") } = {},
) {
  const filter = {
    ...(channel && { channel }),
    ...(region && { region }),
    ...(file && { path: file }),
  };
  const collection = snapshots ?? (await db()).snapshots;
  const stored = await collection.find({ ...filter, fetchedAt: { $gte: from, $lt: to } }).toArray();

  const rows = new Map(stored.map((r) => [String(r._id), r]));
  const matches = (r) =>
    r.fetchedAt >= from && r.fetchedAt < to && Object.entries(filter).every(([key, value]) => r[key] === value);
  for (const day of daysBetween(from, to)) {
    for await (const r of readDay(dir, day)) {
      if (matches(r) && !rows.has(String(r._id))) rows.set(String(r._id), r);
    }
  }
  return [...rows.values()].sort((a, b) => a.fetchedAt - b.fetchedAt);
}
