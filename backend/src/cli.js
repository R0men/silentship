import cron from "node-cron";
import { config } from "./config.js";
import { closeDb, db } from "./db.js";
import { GitArchive } from "./archive/git-archive.js";
import { runChannel } from "./pipeline/run.js";
import { notifyPending, pruneUnconfirmed, sendPreviewEmails } from "./notify/alerts.js";
import { startServer } from "./web/server.js";

let running = false;

/** One crawl of every channel. Channels run sequentially: they share one git archive. */
async function crawlOnce(archive) {
  if (running) {
    console.warn("Previous crawl still running; skipping this tick");
    return;
  }
  running = true;
  try {
    for (const channel of config.channels) {
      try {
        await runChannel(channel, archive);
      } catch (err) {
        console.error(`[${channel}] crawl failed:`, err);
      }
    }
    try {
      await notifyPending();
      await pruneUnconfirmed();
    } catch (err) {
      console.error("notifications failed:", err);
    }
  } finally {
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

const USAGE = `usage:
  cli crawl                                  run every channel once
  cli serve                                  public changelog web server
  cli start                                  web server + scheduled crawls (${config.cron})
  cli dev                                    like start, on a throwaway in-memory MongoDB
  cli watch <email> <pattern> [host,host]    add a watchlist entry, e.g. Excel.Range.* excel
  cli mail-preview <email>                   send a sample confirmation and alert email (real data, dummy tokens)`;

async function main(argv) {
  const [command, ...args] = argv;
  const archive = new GitArchive(config.archiveDir);
  // Fail at startup with one clear message rather than on every crawl tick.
  if (["crawl", "serve", "start", "watch", "mail-preview"].includes(command) && !process.env.MONGODB_URI) {
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
      await startServer();
      cron.schedule(config.cron, () => void crawlOnce(archive), { noOverlap: true });
      void crawlOnce(archive);
      return;
    }
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
      console.log(`Sent 2 preview emails to ${to} (alert: ${sent.channel}/${sent.group}, ${sent.changes} API changes)`);
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
