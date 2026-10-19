import cron from "node-cron";
import { config } from "./config.js";
import { acquireLock, closeDb, db, releaseLock } from "./db.js";
import { GitArchive } from "./archive/git-archive.js";
import { runChannel } from "./pipeline/run.js";
import { notifyPending, pruneUnconfirmed, sendPreviewEmails } from "./notify/alerts.js";
import { startServer } from "./web/server.js";
import { reclassifyStored } from "./analysis/reclassify.js";

let running = false;

/** The crawl lock outlives a normal crawl; it is renewed before each channel. */
const CRAWL_LOCK = "crawl";
const CRAWL_LOCK_TTL_MS = 15 * 60_000;
/** A crawl of every channel should fit the default 10-minute cron interval; a longer one skips ticks. */
const CRAWL_BUDGET_MS = 10 * 60_000;

// A restart (deploy, Ctrl+C) mid-crawl hands the lock back at once instead of blocking the next process
// until it expires.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    setTimeout(() => process.exit(0), 5000).unref();
    const release = running ? releaseLock(CRAWL_LOCK).catch(() => {}) : Promise.resolve();
    void release.finally(() => process.exit(0));
  });
}

/**
 * One crawl of every channel. Channels run sequentially: they share one git archive. Overlapping crawls
 * create duplicate rollouts, so `running` covers this process and the database lock covers every other.
 */
async function crawlOnce(archive) {
  if (running) {
    console.warn("Previous crawl still running; skipping this tick");
    return;
  }
  running = true;
  let locked = false;
  try {
    locked = await acquireLock(CRAWL_LOCK, CRAWL_LOCK_TTL_MS);
    if (!locked) {
      console.warn("Another process is crawling this database; skipping this tick");
      return;
    }
    const startedAt = Date.now();
    for (const channel of config.channels) {
      if (!(await acquireLock(CRAWL_LOCK, CRAWL_LOCK_TTL_MS))) {
        console.warn(`Crawl lock lost before ${channel}; stopping this crawl`);
        return;
      }
      try {
        await runChannel(channel, archive);
      } catch (err) {
        console.error(`[${channel}] crawl failed:`, err);
      }
    }
    const tookMs = Date.now() - startedAt;
    const took = `Crawled ${config.channels.length} channel(s) in ${(tookMs / 1000).toFixed(1)} s`;
    if (tookMs > CRAWL_BUDGET_MS) console.warn(`${took}: longer than ${CRAWL_BUDGET_MS / 60_000} min, ticks will be skipped`);
    else console.log(took);
    try {
      await notifyPending();
      await pruneUnconfirmed();
    } catch (err) {
      console.error("notifications failed:", err);
    }
  } finally {
    if (locked) await releaseLock(CRAWL_LOCK).catch((err) => console.error("releasing crawl lock failed:", err));
    running = false;
  }
}

async function addWatch(email, pattern, hosts) {
  const { subscribers } = await db();
  const res = await subscribers.updateOne(
    { email: email.toLowerCase() },
    { $push: { watchItems: { pattern, hosts } } },
  );
  if (res.matchedCount === 0) throw new Error(`No subscriber ${email}`);
  console.log(`Watching ${pattern}${hosts.length ? ` on ${hosts.join(",")}` : ""} for ${email}`);
}

/** Stored changes saved before classification get their status, and their rollouts' severity drops. */
async function reclassify() {
  const { changes, rollouts } = await reclassifyStored();
  if (changes) console.log(`Reclassified ${changes} stored API change(s); lowered severity of ${rollouts} rollout(s)`);
}

const USAGE = `usage:
  cli crawl                                  run every channel once
  cli serve                                  public changelog web server
  cli start                                  web server + scheduled crawls (${config.cron})
  cli dev                                    like start, on a throwaway in-memory MongoDB
  cli watch <email> <pattern> [host,host]    add a watchlist entry, e.g. Excel.Range.* excel
  cli reclassify                             classify stored API changes saved without an API status
  cli mail-preview <email>                   send sample confirmation, alert and rollback emails (real data, dummy tokens)`;

async function main(argv) {
  const [command, ...args] = argv;
  const archive = new GitArchive(config.archiveDir);
  // Fail at startup with one clear message rather than on every crawl tick.
  if (["crawl", "serve", "start", "watch", "reclassify", "mail-preview"].includes(command) && !process.env.MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is not set (see .env.example), or use `node src/cli.js dev` for an in-memory database.",
    );
  }

  switch (command) {
    case "crawl":
      await archive.init();
      await crawlOnce(archive);
      await closeDb();
      return;
    case "serve":
      await startServer();
      return;
    case "dev": {
      // Throwaway in-memory MongoDB for trying things out without MONGODB_URI.
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
      process.env.MONGODB_URI = mongod.getUri("silentship");
      console.log(`In-memory MongoDB at ${process.env.MONGODB_URI} (data is lost on exit)`);
      await archive.init();
      await startServer();
      cron.schedule(config.cron, () => void crawlOnce(archive), { noOverlap: true });
      void crawlOnce(archive);
      return;
    }
    case "start": {
      await archive.init();
      await reclassify();
      await startServer();
      cron.schedule(config.cron, () => void crawlOnce(archive), { noOverlap: true });
      void crawlOnce(archive);
      return;
    }
    case "reclassify":
      await reclassify();
      await closeDb();
      return;
    case "watch": {
      const [email, pattern, hosts] = args;
      if (!email || !pattern) throw new Error(USAGE);
      await addWatch(email, pattern, hosts ? hosts.split(",").map((h) => h.trim().toLowerCase()) : []);
      await closeDb();
      return;
    }
    case "mail-preview": {
      const [to] = args;
      if (!to) throw new Error(USAGE);
      const sent = await sendPreviewEmails(to);
      console.log(
        `Sent ${sent.emails} preview emails to ${to} (alert: ${sent.channel}/${sent.group}, ${sent.changes} API changes)`,
      );
      await closeDb();
      return;
    }
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
