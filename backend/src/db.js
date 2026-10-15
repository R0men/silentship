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
    c.rollouts.createIndex({ channel: 1, group: 1 }),
    c.rollouts.createIndex({ firstSeenAt: -1 }),
    c.rollouts.createIndex({ notifiedAt: 1 }),
    c.apiChanges.createIndex({ rolloutId: 1 }),
    c.apiChanges.createIndex({ path: 1 }),
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

/** Parses a hex id from a URL; null when malformed. */
export function toObjectId(id) {
  return typeof id === "string" && ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null;
}
