import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { MongoClient, ObjectId } from "mongodb";
import { config } from "./config.js";

export { ObjectId };

let client;
let collections;

/** Database name: MONGODB_DB, else the path of the URI, else "silentship". */
function databaseName(uri) {
  if (config.mongoDb) return config.mongoDb;
  try {
    const name = new URL(uri).pathname.replace(/^\//, "");
    if (name) return decodeURIComponent(name);
  } catch {
    // Unusual URI forms: fall through to the default.
  }
  return "silentship";
}

async function ensureIndexes(c) {
  await Promise.all([
    c.runs.createIndex({ channel: 1, region: 1, startedAt: -1 }),
    c.snapshots.createIndex({ channel: 1, region: 1, path: 1, fetchedAt: -1 }),
    // Per-run sample summaries are diagnostics; keep 90 days.
    c.snapshots.createIndex({ fetchedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
    c.fileStates.createIndex({ channel: 1, region: 1, path: 1 }, { unique: true }),
    c.rollouts.createIndex({ channel: 1, region: 1, path: 1, status: 1 }),
    // A backstop for the crawl lock: one rolling rollout per version of a file.
    c.rollouts.createIndex(
      { channel: 1, region: 1, path: 1, toSha: 1 },
      { unique: true, partialFilterExpression: { status: "rolling" }, name: "one_rolling_per_version" },
    ),
    c.rollouts.createIndex({ channel: 1, group: 1 }),
    c.rollouts.createIndex({ firstSeenAt: -1 }),
    c.rollouts.createIndex({ notifiedAt: 1 }),
    c.apiChanges.createIndex({ rolloutId: 1 }),
    c.apiChanges.createIndex({ path: 1 }),
    // The old name of a rename: /reference pages look types up by `path` or `from`.
    c.apiChanges.createIndex({ from: 1 }),
    c.subscribers.createIndex({ email: 1 }, { unique: true }),
    c.subscribers.createIndex({ token: 1 }, { unique: true }),
    c.deliveries.createIndex({ key: 1, transport: 1, subscriberId: 1 }, { unique: true }),
    c.deliveries.createIndex({ sentAt: 1, failedAt: 1, createdAt: 1 }),
    c.deliveries.createIndex({ kind: 1, channel: 1, group: 1, transport: 1 }),
    // Rendered messages carry addresses; a group's alert history is only needed while it rolls out.
    c.deliveries.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }),
  ]);
}

/**
 * Collections:
 *  runs        — one crawl of a channel: stable loader build, requests, bytes, rollouts created/completed
 *  fileStates  — per file: the stable version (sha, build, Last-Modified floor) and retired versions
 *  rollouts    — one new version of one file spreading across edges: from/to build, share over time, status
 *  snapshots   — per file per run: how many samples returned each version (TTL 90 days)
 *  apiChanges  — one row per changed API path per rollout (can be thousands per rollout)
 *  subscribers — email, token, channels, minSeverity, embedded `watchItems`
 *  deliveries  — outbox: one rendered alert per recipient (email or Slack), sent and retried by
 *                flushDeliveries (TTL 90 days)
 *  locks       — `{_id, owner, expiresAt}`: the crawl lock shared by every process on this database
 */
export async function db() {
  if (!collections) {
    const uri = config.mongoUri;
    client = new MongoClient(uri);
    await client.connect();
    const d = client.db(databaseName(uri));
    collections = {
      runs: d.collection("runs"),
      snapshots: d.collection("snapshots"),
      fileStates: d.collection("fileStates"),
      rollouts: d.collection("rollouts"),
      apiChanges: d.collection("apiChanges"),
      subscribers: d.collection("subscribers"),
      deliveries: d.collection("deliveries"),
      locks: d.collection("locks"),
    };
    await ensureIndexes(collections);
  }
  return collections;
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  collections = undefined;
}

/** Identifies this process in a lock: host, pid and a random suffix (a restarted pid is a new owner). */
const LOCK_OWNER = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

/**
 * Takes (or renews) a lock shared by every process on this database, so two crawlers — a service and a
 * manual run, or two machines — never interleave. The lock expires after `ttlMs` so a crashed holder does
 * not block forever. Returns false when another live owner holds it.
 */
export async function acquireLock(name, ttlMs) {
  const { locks } = await db();
  const now = new Date();
  try {
    await locks.findOneAndUpdate(
      { _id: name, $or: [{ owner: LOCK_OWNER }, { expiresAt: { $lte: now } }] },
      { $set: { owner: LOCK_OWNER, expiresAt: new Date(now.getTime() + ttlMs), takenAt: now } },
      { upsert: true },
    );
    return true;
  } catch (err) {
    // The filter missed because a live owner holds it, so the upsert collided with its _id.
    if (err?.code === 11000) return false;
    throw err;
  }
}

export async function releaseLock(name) {
  const { locks } = await db();
  await locks.deleteOne({ _id: name, owner: LOCK_OWNER });
}

/** Parses a hex id from a URL; null when malformed. */
export function toObjectId(id) {
  return typeof id === "string" && ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null;
}
