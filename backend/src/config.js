import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** Repository root: one .env and one data/ directory shared by backend and frontend. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export const CHANNEL_BASE_URL = {
  prod: "https://appsforoffice.microsoft.com/lib/1/hosted/",
  beta: "https://appsforoffice.microsoft.com/lib/beta/hosted/",
  // Microsoft's recommended endpoint since September 2026 (the one above is "legacy" in its docs). The loader
  // takes its base path from its own <script src>, so add-ins on it load every host file from here too.
  "onecdn-prod": "https://officeapis.public.onecdn.static.microsoft/1/",
  "onecdn-beta": "https://officeapis.public.onecdn.static.microsoft/beta/",
};

/**
 * Each OneCDN channel mirrors a legacy one: the same builds and the same host files, only its own office.js
 * (security-default flags). Subscribers choose release or preview, not an endpoint, so a OneCDN channel
 * alerts the subscribers of its legacy channel.
 */
export const LEGACY_CHANNEL = { "onecdn-prod": "prod", "onecdn-beta": "beta" };

/** The legacy channel itself for prod/beta. */
export const legacyOf = (channel) => LEGACY_CHANNEL[channel] ?? channel;

/** prod ↔ onecdn-prod, beta ↔ onecdn-beta. */
export function pairedChannel(channel) {
  if (LEGACY_CHANNEL[channel]) return LEGACY_CHANNEL[channel];
  return Object.keys(LEGACY_CHANNEL).find((c) => LEGACY_CHANNEL[c] === channel) ?? null;
}

function env(name, fallback) {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}`);
}

function parseChannels(raw) {
  const channels = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const c of channels) {
    if (!(c in CHANNEL_BASE_URL)) throw new Error(`Unknown channel "${c}" in CHANNELS`);
  }
  return channels;
}

export const config = {
  /** Read lazily so tests and `cli` usage text work without a database configured. */
  get mongoUri() {
    return env("MONGODB_URI");
  },
  /** Database name; defaults to the one in the URI, else "silentship". */
  mongoDb: process.env.MONGODB_DB || undefined,
  archiveDir: path.resolve(ROOT, env("ARCHIVE_DIR", "./data/archive")),
  region: env("REGION", "local"),
  /** Crawled one after another in this order: legacy first, so the new endpoint never delays it. */
  channels: parseChannels(env("CHANNELS", "prod,beta,onecdn-prod,onecdn-beta")),
  cron: env("CRON", "*/10 * * * *"),
  fullRefreshHours: Number(env("FULL_REFRESH_HOURS", "6")),
  /** Not PORT: Next.js reads that one. The API sits behind the frontend, so localhost by default. */
  port: Number(env("API_PORT", "4000")),
  host: env("API_HOST", "127.0.0.1"),
  /**
   * Which proxies may set the client address (X-Forwarded-For). Next and nginx reach the API over loopback,
   * so trust loopback only: req.ip becomes the rightmost non-loopback entry, the one nginx wrote, and a
   * client-supplied value further left is ignored. (Fastify's numeric hop count does not work for this.)
   */
  trustProxy: env("TRUST_PROXY", "loopback"),
  /** Cap on confirmation emails across all visitors, per hour. */
  maxConfirmationsPerHour: Number(env("MAX_CONFIRMATIONS_PER_HOUR", "200")),
  /** /health turns 503 when a channel has not finished a crawl for this long. */
  healthStaleMinutes: Number(env("HEALTH_STALE_MINUTES", "20")),
  /** Public URL of the frontend: links in emails and RSS. */
  publicUrl: env("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, ""),
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL || undefined,
  brevoApiKey: process.env.BREVO_API_KEY || undefined,
  mailFromEmail: env("MAIL_FROM_EMAIL", "alerts@example.com"),
  mailFromName: env("MAIL_FROM_NAME", "silentship"),
  /** Locales whose office_strings.js we track. en-us is the default the loader falls back to. */
  locales: env("LOCALES", "en-us")
    .split(",")
    .map((l) => l.trim().toLowerCase()),
  fetchConcurrency: Number(env("FETCH_CONCURRENCY", "6")),
  /**
   * Requests per file per run, each on a fresh connection. Shares are reported in steps of 1/SAMPLES.
   * Cheap: requests are conditional, so edges serving the stable version answer 304 with no body.
   */
  samples: Math.max(1, Number(env("SAMPLES", "8"))),
  /** Heap limit of the sandboxed API-reflection worker (one runs at a time). */
  workerMaxMb: Number(env("WORKER_MAX_MB", "1024")),
  /** Alerts wait until a channel has had no new changes for this long (rollouts trickle across edges). */
  alertQuietMinutes: Number(env("ALERT_QUIET_MINUTES", "20")),
};
