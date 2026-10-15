import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { SEVERITY_RANK } from "../analysis/diff.js";
import { confirmEmail } from "../notify/email-templates.js";
import { sendEmail } from "../notify/senders.js";
import { esc } from "../util/html.js";
import { crawlerHealth, getGroup, listGroups, overview, sitemapGroups } from "./queries.js";
import { createLiveFeed } from "./live.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNELS = new Set(["prod", "beta"]);
const GROUP_RE = /^[\w.-]{1,80}$/;

const pct = (share) => `${Math.round(share * 100)}%`;

export function rssFeed(groups, publicUrl) {
  const items = groups
    .map((g) => {
      const link = `${publicUrl}/rollouts/${g.channel}/${encodeURIComponent(g.group)}`;
      const what = g.toBuild ? `build ${g.toBuild}` : g.removal ? "files removed" : "unversioned file change";
      const title = `[${g.severity}] Office.js ${g.channel}: ${what}`;
      const description =
        `${g.files} file(s), ${g.status === "complete" ? "rollout complete" : `on ~${pct(g.share)} of sampled edges`}, ` +
        `${g.apiChangeCount} API change(s).${g.fromBuilds.length ? ` From ${g.fromBuilds.join(", ")}.` : ""}`;
      return (
        `<item><title>${esc(title)}</title><link>${esc(link)}</link><guid isPermaLink="true">${esc(link)}</guid>` +
        `<pubDate>${new Date(g.firstSeenAt).toUTCString()}</pubDate><description>${esc(description)}</description></item>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>silentship — Office.js CDN rollouts</title>` +
    `<link>${esc(publicUrl)}</link><description>New Office.js builds spreading across appsforoffice.microsoft.com</description>${items}</channel></rss>`
  );
}

/** Tiny per-IP limiter for the subscribe form: it sends email, so it is worth abusing. */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear();
    return recent.length <= limit;
  };
}

export async function buildServer() {
  // `true` would trust the whole X-Forwarded-For header, letting anyone pick their own IP; see config.trustProxy.
  const app = Fastify({ logger: { level: "info" }, trustProxy: config.trustProxy });
  const allowSubscribe = rateLimiter(5, 3600_000);
  // Global cap on confirmation emails: protects the Brevo quota and sender reputation from a botnet.
  const allowConfirmationEmail = rateLimiter(config.maxConfirmationsPerHour, 3600_000);

  /** For uptime monitors: 503 unless every channel finished a crawl recently and none is stuck. */
  app.get("/health", async (_req, reply) => {
    const report = await crawlerHealth();
    return reply.code(report.ok ? 200 : 503).send(report);
  });

  app.get("/api/overview", async () => overview());

  /** Rollouts grouped by target build, newest first. */
  app.get("/api/rollouts", async (req) => {
    const before = req.query.before ? new Date(req.query.before) : null;
    const groups = await listGroups({
      channel: CHANNELS.has(req.query.channel) ? req.query.channel : null,
      severity: SEVERITY_RANK[req.query.severity] !== undefined ? req.query.severity : null,
      before: before && !Number.isNaN(before.getTime()) ? before : null,
      limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    });
    return { rollouts: groups };
  });

  app.get("/api/rollouts/:channel/:group", async (req, reply) => {
    const { channel, group } = req.params;
    if (!CHANNELS.has(channel) || !GROUP_RE.test(group)) return reply.code(404).send({ error: "not_found" });
    const detail = await getGroup(channel, group);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });

  /** Keys and dates of every rollout page; the frontend renders /sitemap.xml from it. */
  app.get("/api/sitemap", async () => ({ rollouts: await sitemapGroups() }));

  app.get("/rss.xml", async (_req, reply) => {
    reply.type("application/rss+xml; charset=utf-8").send(rssFeed(await listGroups({ limit: 50 }), config.publicUrl));
  });

  app.post("/api/subscribe", { bodyLimit: 4096 }, async (req, reply) => {
    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return reply.code(400).send({ error: "invalid_email" });
    if (!allowSubscribe(req.ip)) return reply.code(429).send({ error: "too_many_requests" });

    const channels = req.body?.beta ? ["prod", "beta"] : ["prod"];
    const { subscribers } = await db();
    const existing = await subscribers.findOne({ email });
    let sub;
    if (!existing) {
      sub = {
        email,
        token: randomBytes(24).toString("base64url"),
        createdAt: new Date(),
        confirmedAt: null,
        unsubscribedAt: null,
        minSeverity: "low",
        channels,
        watchItems: [],
      };
      await subscribers.insertOne(sub);
    } else {
      // Anyone can submit any address, so a previously unsubscribed one must confirm again,
      // and a confirmed one keeps its settings.
      const update = existing.unsubscribedAt
        ? { channels, unsubscribedAt: null, confirmedAt: null }
        : existing.confirmedAt
          ? {}
          : { channels };
      sub = { ...existing, ...update };
      if (Object.keys(update).length) await subscribers.updateOne({ _id: existing._id }, { $set: update });
    }
    if (!sub.confirmedAt) {
      // At most 3 confirmation emails per address per day, so the form cannot be used to flood an inbox.
      const dayAgo = Date.now() - 24 * 3600_000;
      const recent = (sub.confirmationsSent ?? []).filter((t) => new Date(t).getTime() > dayAgo);
      if (recent.length < 3) {
        if (!allowConfirmationEmail("global")) return reply.code(429).send({ error: "too_many_requests" });
        const link = `${config.publicUrl}/confirm?token=${sub.token}`;
        await sendEmail({ to: email, ...confirmEmail({ link, channels: sub.channels ?? channels }) });
        await subscribers.updateOne({ email }, { $set: { confirmationsSent: [...recent, new Date()] } });
      }
    }
    // Same answer whether or not the address was already known, so the form does not leak subscribers.
    return { ok: true };
  });

  app.get("/confirm", async (req, reply) => {
    const { subscribers } = await db();
    const token = typeof req.query.token === "string" ? req.query.token : null;
    const sub = token ? await subscribers.findOne({ token }) : null;
    if (!sub) return reply.redirect(`${config.publicUrl}/?notice=invalid-link`);
    await subscribers.updateOne(
      { _id: sub._id },
      { $set: { confirmedAt: sub.confirmedAt ?? new Date(), unsubscribedAt: null } },
    );
    return reply.redirect(`${config.publicUrl}/?notice=confirmed`);
  });

  app.get("/unsubscribe", async (req, reply) => {
    const { subscribers } = await db();
    const token = typeof req.query.token === "string" ? req.query.token : null;
    const sub = token ? await subscribers.findOne({ token }) : null;
    if (!sub) return reply.redirect(`${config.publicUrl}/?notice=invalid-link`);
    await subscribers.updateOne({ _id: sub._id }, { $set: { unsubscribedAt: new Date() } });
    return reply.redirect(`${config.publicUrl}/?notice=unsubscribed`);
  });

  // RFC 8058 one-click unsubscribe: mail clients POST "List-Unsubscribe=One-Click" to the header URL.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );
  app.post("/unsubscribe", async (req, reply) => {
    const { subscribers } = await db();
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (token) await subscribers.updateOne({ token }, { $set: { unsubscribedAt: new Date() } });
    return reply.code(200).send({ ok: true });
  });

  // Live updates (Server-Sent Events): a fresh snapshot whenever a crawl starts or finishes.
  const live = createLiveFeed();
  app.get("/api/live", (req, reply) => live.handle(req, reply));
  app.addHook("onReady", async () => live.start());
  app.addHook("preClose", async () => live.stop());

  return app;
}

export async function startServer() {
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  return app;
}
