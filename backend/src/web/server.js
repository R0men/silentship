import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { config } from "../config.js";
import { db } from "../db.js";
import { SEVERITY_RANK } from "../analysis/diff.js";
import { alreadySubscribedEmail, confirmEmail, welcomeEmail } from "../notify/email-templates.js";
import { sendEmail } from "../notify/senders.js";
import { esc } from "../util/html.js";
import {
  apiChangesLine,
  crawlerHealth,
  plural,
  getApiType,
  getRelease,
  homeSnapshot,
  isTrack,
  listApiTypes,
  listReleases,
  overview,
  sitemapReleases,
  TYPE_RE,
} from "./queries.js";
import { createLiveFeed } from "./live.js";
import { actionPage } from "./action-page.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GROUP_RE = /^[\w.-]{1,80}$/;

const pct = (share) => `${Math.round(share * 100)}%`;

export { apiChangesLine };

export function rssFeed(groups, publicUrl) {
  const items = groups
    .map((g) => {
      const link = `${publicUrl}/rollouts/${g.channel}/${encodeURIComponent(g.group)}`;
      const what = g.toBuild ? `build ${g.toBuild}` : g.removal ? "files removed" : "unversioned file change";
      const title = `[${g.severity}] Office.js ${g.channel}: ${what}`;
      const api = apiChangesLine(g);
      const description =
        `${api[0].toUpperCase()}${api.slice(1)}. ` +
        `${plural(g.files, "file")}, ${g.status === "complete" ? "rollout complete" : `on ~${pct(g.share)} of sampled edges`}.` +
        `${g.fromBuilds.length ? ` From ${g.fromBuilds.join(", ")}.` : ""}`;
      return (
        `<item><title>${esc(title)}</title><link>${esc(link)}</link><guid isPermaLink="true">${esc(link)}</guid>` +
        `<pubDate>${new Date(g.firstSeenAt).toUTCString()}</pubDate><description>${esc(description)}</description></item>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>silentship — Office.js CDN rollouts</title>` +
    `<link>${esc(publicUrl)}</link><description>New Office.js builds spreading across appsforoffice.microsoft.com and officeapis.public.onecdn.static.microsoft</description>${items}</channel></rss>`
  );
}

/** A subscriber's source as stored: lower case letters, digits, dots and dashes, at most 64; else "direct". */
export function signupSource(raw) {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 64);
  return s || "direct";
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

  /** The home page in one call: the same snapshot /api/live pushes. */
  app.get("/api/home", async () => homeSnapshot());

  /** Releases (one per track and build, both endpoints), newest first; `channel` is the track. */
  app.get("/api/rollouts", async (req) => {
    const before = req.query.before ? new Date(req.query.before) : null;
    const groups = await listReleases({
      track: isTrack(req.query.channel) ? req.query.channel : null,
      severity: SEVERITY_RANK[req.query.severity] !== undefined ? req.query.severity : null,
      before: before && !Number.isNaN(before.getTime()) ? before : null,
      limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    });
    return { rollouts: groups };
  });

  app.get("/api/rollouts/:channel/:group", async (req, reply) => {
    const { channel, group } = req.params;
    if (!isTrack(channel) || !GROUP_RE.test(group)) return reply.code(404).send({ error: "not_found" });
    const detail = await getRelease(channel, group);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });

  /** Every API type changed by a confirmed rollout: the /reference hub. */
  app.get("/api/types", async () => ({ types: await listApiTypes() }));

  /** One type's change history; `type` in the reply is the canonical spelling (lookup is case-insensitive). */
  app.get("/api/types/:type", async (req, reply) => {
    const { type } = req.params;
    if (type.length > 200 || !TYPE_RE.test(type)) return reply.code(404).send({ error: "not_found" });
    const detail = await getApiType(type);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });

  /** Keys and dates of every rollout and API type page; the frontend renders /sitemap.xml from it. */
  app.get("/api/sitemap", async () => {
    const [rollouts, types] = await Promise.all([sitemapReleases(), listApiTypes()]);
    return { rollouts, types: types.map((t) => ({ type: t.type, lastModified: t.lastModified })) };
  });

  app.get("/rss.xml", async (_req, reply) => {
    reply.type("application/rss+xml; charset=utf-8").send(rssFeed(await listReleases({ limit: 50 }), config.publicUrl));
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
        // First touch only: utm_source, a referrer's domain or "direct" — one word, no IP, no URL.
        source: signupSource(req.body?.source),
        createdAt: new Date(),
        confirmedAt: null,
        unsubscribedAt: null,
        minSeverity: "low",
        channels,
        watchItems: [],
      };
      await subscribers.insertOne(sub);
    } else {
      // Anyone can submit any address, so a previously unsubscribed one must confirm again, and a confirmed
      // one keeps its settings: a channel it does not have yet waits in pendingChannels for the click.
      const addsChannel = channels.some((c) => !(existing.channels ?? []).includes(c));
      const update = existing.unsubscribedAt
        ? { channels, unsubscribedAt: null, confirmedAt: null }
        : !existing.confirmedAt
          ? { channels }
          : addsChannel
            ? { pendingChannels: [...new Set([...(existing.channels ?? []), ...channels])] }
            : {};
      sub = { ...existing, ...update };
      if (Object.keys(update).length) await subscribers.updateOne({ _id: existing._id }, { $set: update });
    }
    // Every submit gets an email, so the form's "check your inbox" is true and the reply leaks nothing.
    // Per address: one a minute, 3 per 10 minutes, 10 a day, so the form cannot be used to flood an inbox.
    // The slot is claimed atomically: parallel submits must not all pass the check before any of them records it.
    const now = new Date();
    const ago = (ms) => new Date(now.getTime() - ms);
    const sentToday = { $filter: { input: { $ifNull: ["$confirmationsSent", []] }, cond: { $gt: ["$$this", ago(24 * 3600_000)] } } };
    const sentSince = (ms) => ({ $size: { $filter: { input: sentToday, cond: { $gt: ["$$this", ago(ms)] } } } });
    const { modifiedCount } = await subscribers.updateOne(
      {
        email,
        $expr: {
          $and: [
            { $lt: [{ $size: sentToday }, 10] },
            { $lt: [sentSince(10 * 60_000), 3] },
            { $eq: [sentSince(60_000), 0] },
          ],
        },
      },
      [{ $set: { confirmationsSent: { $concatArrays: [sentToday, [now]] } } }],
    );
    if (modifiedCount) {
      if (!allowConfirmationEmail("global")) return reply.code(429).send({ error: "too_many_requests" });
      const link = `${config.publicUrl}/confirm?token=${sub.token}`;
      const message =
        !sub.confirmedAt || sub.pendingChannels
          ? { ...confirmEmail({ link, channels: sub.pendingChannels ?? sub.channels ?? channels }), replyTo: config.mailReplyTo }
          : alreadySubscribedEmail({
              channels: sub.channels,
              unsubscribe: `${config.publicUrl}/unsubscribe?token=${sub.token}`,
            });
      await sendEmail({ to: email, ...message });
    }
    // Same answer whether or not the address was already known, so the form does not leak subscribers.
    return { ok: true };
  });

  // Email links: GET only shows a page with a button (mail scanners open every link), POST changes state.
  async function subscriberByToken(req) {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!token) return null;
    const { subscribers } = await db();
    return subscribers.findOne({ token });
  }
  const notice = (reply, name) => reply.redirect(`${config.publicUrl}/?notice=${name}`, 303);
  const page = (reply, args) => reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(actionPage(args));

  app.get("/confirm", async (req, reply) => {
    const sub = await subscriberByToken(req);
    if (!sub) return notice(reply, "invalid-link");
    if (sub.confirmedAt && !sub.unsubscribedAt && !sub.pendingChannels) return notice(reply, "confirmed");
    const channels = sub.pendingChannels ?? sub.channels ?? ["prod"];
    return page(reply, {
      title: "Confirm your subscription",
      text: `Alerts about Office.js rollouts on the ${channels.includes("beta") ? "production and beta channels" : "production channel"} will go to ${sub.email}.`,
      button: "Confirm",
      action: `/confirm?token=${encodeURIComponent(sub.token)}`,
    });
  });

  app.post("/confirm", async (req, reply) => {
    const sub = await subscriberByToken(req);
    if (!sub) return notice(reply, "invalid-link");
    const { subscribers } = await db();
    const channels = sub.pendingChannels ?? sub.channels;
    await subscribers.updateOne(
      { _id: sub._id },
      {
        $set: { confirmedAt: sub.confirmedAt ?? new Date(), unsubscribedAt: null, channels },
        $unset: { pendingChannels: "" },
      },
    );
    // A welcome once, on the first confirmation; an atomic flag so a double click does not send two.
    const { modifiedCount } = sub.confirmedAt
      ? { modifiedCount: 0 }
      : await subscribers.updateOne({ _id: sub._id, welcomedAt: null }, { $set: { welcomedAt: new Date() } });
    if (modifiedCount) {
      const unsubscribe = `${config.publicUrl}/unsubscribe?token=${sub.token}`;
      await sendEmail({
        to: sub.email,
        ...welcomeEmail({ channels: channels ?? ["prod"], unsubscribe }),
        replyTo: config.mailReplyTo,
        headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }).catch((err) => req.log.error(`welcome email to subscriber failed: ${String(err)}`));
    }
    return notice(reply, "confirmed");
  });

  app.get("/unsubscribe", async (req, reply) => {
    const sub = await subscriberByToken(req);
    if (!sub) return notice(reply, "invalid-link");
    if (sub.unsubscribedAt) return notice(reply, "unsubscribed");
    return page(reply, {
      title: "Unsubscribe",
      text: `Stop Office.js alerts to ${sub.email}.`,
      button: "Unsubscribe",
      action: `/unsubscribe?token=${encodeURIComponent(sub.token)}`,
    });
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );
  // The button on the page above, and RFC 8058 one-click unsubscribe: mail clients POST
  // "List-Unsubscribe=One-Click" to the header URL and expect a plain 200, not a redirect.
  app.post("/unsubscribe", async (req, reply) => {
    const sub = await subscriberByToken(req);
    if (sub) {
      const { subscribers } = await db();
      await subscribers.updateOne({ _id: sub._id }, { $set: { unsubscribedAt: sub.unsubscribedAt ?? new Date() } });
    }
    if (String(req.body ?? "").includes("List-Unsubscribe=One-Click")) return reply.code(200).send({ ok: true });
    return notice(reply, sub ? "unsubscribed" : "invalid-link");
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
