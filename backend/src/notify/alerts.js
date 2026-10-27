import { config, LEGACY_CHANNEL, legacyOf } from "../config.js";
import { db } from "../db.js";
import { maxSeverity, SEVERITY_RANK } from "../analysis/diff.js";
import { matchingChanges } from "../analysis/watchlist.js";
import { flagsChangeNotice } from "../crawler/loader.js";
import { hostTypeOf } from "../crawler/manifest.js";
import { CONFIRM_RUNS } from "../pipeline/rollouts.js";
import { apiChangesLine, countChanges, listGroups, plural } from "../web/queries.js";
import { alertEmail, confirmEmail, rollbackEmail, SUPPORT_URL } from "./email-templates.js";
import { postSlack, sendEmail } from "./senders.js";

/** One entry per API path, listing the host files it changed in; most severe first. */
function apiEntries(changes) {
  const byPath = new Map();
  for (const c of changes) {
    const entry = byPath.get(c.path) ?? {
      path: c.path,
      kind: c.kind,
      severity: c.severity,
      from: c.from,
      status: c.apiStatus,
      apiSet: c.apiSet,
      hosts: new Set(),
    };
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[entry.severity]) entry.severity = c.severity;
    entry.hosts.add(c.hostType ?? c.file);
    byPath.set(c.path, entry);
  }
  return [...byPath.values()]
    .map((e) => ({ ...e, hosts: [...e.hosts].sort() }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.path.localeCompare(b.path));
}

function entryLine(e) {
  const what = e.kind === "renamed" && e.from ? `renamed from ${e.from.split(".").pop()}` : e.kind;
  const tag = e.status && e.status !== "ga" ? ` · ${e.status}` : e.apiSet ? ` · ${e.apiSet}` : "";
  return `[${e.severity}] ${e.path} — ${what}${tag} (${e.hosts.join(", ")})`;
}

/** Plain-text lines for Slack and the text part of emails. */
function summarizeApi(changes, limit = 25) {
  const lines = apiEntries(changes).map(entryLine);
  return lines.length > limit ? [...lines.slice(0, limit), `… and ${lines.length - limit} more`] : lines;
}

const pct = (share) => `${Math.round(share * 100)}%`;

/**
 * A group may alert once any of its files has been sighted in CONFIRM_RUNS runs, or has completed.
 * listGroups applies the same rule in its aggregate (`confirmed`), so the site shows exactly these groups.
 */
export function groupConfirmed(rollouts) {
  return rollouts.some(
    (r) => r.status === "complete" || (r.history ?? []).filter((h) => h.share > 0).length >= CONFIRM_RUNS,
  );
}

/**
 * Whether a rollout deserves an email to a subscriber without a watchlist: a new build that changed no
 * public API is noise for add-in developers. High (e.g. a removed file) and a loader-flags-changed event
 * always count. Slack still gets it (unless a OneCDN duplicate, see alertsFromChannel).
 */
export function emailWorthy({ changes, severity, flagsChanged = false }) {
  return changes.length > 0 || severity === "high" || flagsChanged;
}

/**
 * OneCDN serves the same host files as legacy, so one build is a group on both and would be two alerts.
 * Legacy channels alert as before; a OneCDN channel (email and Slack) only for what legacy cannot tell: its
 * loader's security-default flags changed, or a build legacy has not shown (no rollout of that group there,
 * and no legacy file stable on it).
 */
async function alertsFromChannel(channel, group, flagsChanged) {
  const legacy = LEGACY_CHANNEL[channel];
  if (!legacy || flagsChanged) return true;
  const { rollouts, fileStates } = await db();
  const query = { projection: { _id: 1 } };
  const onLegacy =
    (await rollouts.findOne({ channel: legacy, region: config.region, group }, query)) ??
    (await fileStates.findOne({ channel: legacy, region: config.region, stableBuild: group }, query));
  return !onLegacy;
}

/** Every file of a confirmed group stopped being served for ABANDON_MS: Microsoft pulled the build back. */
export function groupRolledBack(rollouts) {
  return rollouts.length > 0 && rollouts.every((r) => r.status === "abandoned") && groupConfirmed(rollouts);
}

/** Rollback candidates: groups with a recently abandoned file that has not had a rollback alert yet. */
async function findRollbacks(now) {
  const { rollouts, apiChanges } = await db();
  const recent = await rollouts
    .find(
      {
        status: "abandoned",
        rollbackNotifiedAt: null,
        lastSeenAt: { $gte: new Date(now.getTime() - 7 * 24 * 3600_000) },
      },
      { projection: { channel: 1, group: 1 } },
    )
    .toArray();
  const keys = [...new Map(recent.map((r) => [`${r.channel}\u0000${r.group}`, r])).values()];
  const groups = [];
  for (const { channel, group } of keys) {
    const items = await rollouts.find({ channel, group, region: config.region }).toArray();
    if (!groupRolledBack(items)) continue;
    const rows = await apiChanges.find({ rolloutId: { $in: items.map((r) => r._id) } }).toArray();
    groups.push({
      channel,
      group,
      items: items.map((r) => ({ ...r, apiChanges: rows.filter((c) => c.rolloutId.equals(r._id)) })),
    });
  }
  return groups;
}

async function findPending() {
  const { rollouts, apiChanges } = await db();
  const pending = await rollouts
    .find({ notifiedAt: null, status: { $ne: "abandoned" } }, { sort: { firstSeenAt: 1 } })
    .toArray();
  if (pending.length === 0) return [];
  const rows = await apiChanges.find({ rolloutId: { $in: pending.map((r) => r._id) } }).toArray();
  return pending.map((r) => ({ ...r, apiChanges: rows.filter((c) => c.rolloutId.equals(r._id)) }));
}

/** Unconfirmed sign-ups are deleted after 30 days; we keep no address the owner did not confirm. */
export async function pruneUnconfirmed(now = new Date()) {
  const { subscribers } = await db();
  const { deletedCount } = await subscribers.deleteMany({
    confirmedAt: null,
    createdAt: { $lt: new Date(now.getTime() - 30 * 24 * 3600_000) },
  });
  return deletedCount;
}

/**
 * A Microsoft release reaches the host files one by one over several crawls. Alerts wait until a channel
 * has had no new rollout for `quietMinutes`, then are queued as one message per target build; files of an
 * already alerted build only produce an "update" with the API changes not sent yet. flushDeliveries sends
 * the queue and retries failures on later crawls.
 */
export async function notifyPending(quietMinutes = config.alertQuietMinutes, now = new Date()) {
  const byChannel = new Map();
  for (const r of await findPending()) byChannel.set(r.channel, [...(byChannel.get(r.channel) ?? []), r]);

  for (const [channel, rollouts] of byChannel) {
    const latest = rollouts[rollouts.length - 1];
    if (now.getTime() - latest.firstSeenAt.getTime() < quietMinutes * 60_000) continue;
    const byGroup = new Map();
    for (const r of rollouts) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    for (const [group, items] of byGroup) {
      // Unconfirmed groups stay pending; if they never show up again they are abandoned without an alert.
      if (groupConfirmed(items)) await notifyGroup(channel, group, items);
    }
  }

  for (const { channel, group, items } of await findRollbacks(now)) await notifyRollback(channel, group, items);
  await flushDeliveries(now);
}

/** Attempts per queued message, one per crawl: a few hours of a Brevo or Slack outage lose nothing. */
export const MAX_ATTEMPTS = 24;

/** Queues messages; one already queued under the same key for the same recipient is skipped (a re-run). */
async function enqueue(messages) {
  if (messages.length === 0) return;
  const { deliveries } = await db();
  const createdAt = new Date();
  const docs = messages.map((m) => ({ ...m, createdAt, sentAt: null, failedAt: null, attempts: 0, lastError: null }));
  try {
    await deliveries.insertMany(docs, { ordered: false });
  } catch (err) {
    if (!(err.writeErrors ?? [err]).every((e) => e.code === 11000)) throw err;
  }
}

/**
 * Sends every queued message. A failure stays queued for the next crawl until MAX_ATTEMPTS; an email to a
 * subscriber who unsubscribed meanwhile is dropped.
 */
export async function flushDeliveries(now = new Date()) {
  const { deliveries, subscribers } = await db();
  const queue = await deliveries.find({ sentAt: null, failedAt: null }, { sort: { createdAt: 1 } }).toArray();
  const result = { sent: 0, failed: 0, dropped: 0 };
  for (const d of queue) {
    if (d.transport === "email") {
      const sub = await subscribers.findOne({ _id: d.subscriberId });
      if (!sub?.confirmedAt || sub.unsubscribedAt) {
        await deliveries.updateOne({ _id: d._id }, { $set: { failedAt: now, lastError: "subscriber inactive" } });
        result.dropped++;
        continue;
      }
    }
    try {
      if (d.transport === "slack") await postSlack(d.message.text);
      else await sendEmail({ to: d.to, ...d.message });
      await deliveries.updateOne({ _id: d._id }, { $set: { sentAt: now }, $inc: { attempts: 1 } });
      result.sent++;
    } catch (err) {
      const attempts = d.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await deliveries.updateOne(
        { _id: d._id },
        { $set: { attempts, lastError: String(err).slice(0, 500), failedAt: giveUp ? now : null } },
      );
      console.error(
        `${d.transport} delivery ${d.key} failed (attempt ${attempts}/${MAX_ATTEMPTS}${giveUp ? ", giving up" : ""}): ${String(err)}`,
      );
      result.failed++;
    }
  }
  return result;
}

/** Everything an alert about one rollout group needs, computed once for Slack and every subscriber. */
async function groupContext(channel, group, rollouts) {
  // The site shows a build once per track (production, beta), with both endpoints on one page.
  const url = `${config.publicUrl}/rollouts/${legacyOf(channel)}/${encodeURIComponent(group)}`;
  const changes = rollouts.flatMap((r) =>
    r.apiChanges.map((c) => ({
      path: c.path,
      kind: c.kind,
      severity: c.severity,
      from: c.from,
      apiStatus: c.apiStatus,
      apiSet: c.apiSet,
      file: c.file,
      hostType: hostTypeOf(c.file),
    })),
  );
  const severity = maxSeverity(rollouts.map((r) => r.severity));
  const toBuild = rollouts[0].toBuild;
  const fromBuilds = [...new Set(rollouts.map((r) => r.fromBuild).filter(Boolean))];
  // Same numbers as the site: one definition in listGroups.
  const [summary] = await listGroups({ channel, group, limit: 1 });
  const share = summary?.share ?? 0;
  const files = summary?.files ?? rollouts.length;
  const removed = rollouts[0].toSha === null;
  const what = toBuild
    ? `rollout of build ${toBuild}${fromBuilds.length ? ` (from ${fromBuilds.join(", ")})` : ""}`
    : removed
      ? "files removed"
      : "content change without a build stamp";
  const header =
    `Office.js ${channel}: ${what} [${severity}] — ${apiChangesLine(countChanges(changes))}; ` +
    `${files} file(s), on ~${pct(share)} of sampled edges`;
  const title = toBuild ?? (removed ? "Files removed" : "Unversioned change");
  // loader-flags-changed: office.js of this batch sets the security defaults differently.
  const flagged = rollouts.find((r) => r.flagsChanged);
  return {
    channel,
    url,
    changes,
    severity,
    flagsChanged: Boolean(flagged),
    notice: flagged ? flagsChangeNotice(channel, flagged.fromFlags, flagged.toFlags) : null,
    toBuild,
    fromBuilds,
    share,
    files,
    status: summary?.status,
    what,
    header,
    title,
  };
}

/** Subject, text and HTML of one subscriber's alert; `update`: a follow-up carrying only new API changes. */
function renderAlert(ctx, { changes, severity, unsubscribe, watched, update = false }) {
  const entries = apiEntries(changes);
  const limit = 25;
  // The same count as the site and RSS: one per API path and kind, however many host files carry it.
  const counts = countChanges(changes);
  const what = ctx.notice
    ? "loader security defaults changed"
    : ctx.toBuild
      ? `build ${ctx.toBuild} rolling out`
      : ctx.what;
  const count = update
    ? !ctx.notice && ` — update, ${plural(counts.uniqueApiChanges, "new API change")}`
    : !ctx.notice && counts.uniqueApiChanges > 0 && ` — ${plural(counts.uniqueApiChanges, "API change")}`;
  const subject = `[${severity}] Office.js ${ctx.channel}: ${what}${count || ""}`;
  return {
    subject,
    text: [
      update ? subject : ctx.header,
      ...(ctx.notice ? ["", ctx.notice] : []),
      "",
      ...summarizeApi(changes, limit),
      "",
      ctx.url,
      "",
      `Unsubscribe: ${unsubscribe}`,
      `Support silentship: ${SUPPORT_URL}`,
    ].join("\n"),
    html: alertEmail({
      channel: ctx.channel,
      title: ctx.title,
      notice: ctx.notice,
      fromBuilds: ctx.fromBuilds,
      severity,
      status: ctx.status,
      files: ctx.files,
      share: ctx.share,
      totalChanges: counts.uniqueApiChanges,
      changeFiles: counts.apiChangeFiles,
      entries: entries.slice(0, limit),
      more: Math.max(0, entries.length - limit),
      url: ctx.url,
      unsubscribe,
      watched,
      update,
    }),
  };
}

const unsubscribeUrl = (sub) => `${config.publicUrl}/unsubscribe?token=${sub.token}`;
// Gmail/Yahoo bulk-sender rules: one-click unsubscribe (RFC 8058).
const unsubscribeHeaders = (url) => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
/** Subscribers pick release or preview, not an endpoint: a OneCDN channel reaches its legacy channel's. */
const activeSubscribers = async (channel) =>
  (await db()).subscribers
    .find({ confirmedAt: { $ne: null }, unsubscribedAt: null, channels: legacyOf(channel) })
    .toArray();
const watchesOf = (sub) => (sub.watchItems ?? []).map((w) => ({ pattern: w.pattern, hosts: w.hosts ?? [] }));

/** `changes` without those already in `sent`, by API path and kind (the hosts are detail, not news). */
export function newChanges(changes, sent) {
  const seen = new Set(sent.map((c) => `${c.path}\u0000${c.kind}`));
  return changes.filter((c) => !seen.has(`${c.path}\u0000${c.kind}`));
}

/** API changes of the group's files that were alerted on before, or null if none were. */
async function alertedChanges(channel, group) {
  const { rollouts, apiChanges } = await db();
  const prior = await rollouts
    .find({ channel, group, region: config.region, notifiedAt: { $ne: null } }, { projection: { _id: 1 } })
    .toArray();
  if (prior.length === 0) return null;
  const rows = await apiChanges.find({ rolloutId: { $in: prior.map((r) => r._id) } }).toArray();
  return rows.map((c) => ({ path: c.path, kind: c.kind, severity: c.severity, file: c.file, hostType: hostTypeOf(c.file) }));
}

async function notifyGroup(channel, group, rollouts) {
  const ctx = await groupContext(channel, group, rollouts);
  // A build reaches the files over hours. The first alert covers what is there; later batches of the same
  // build are updates carrying only API changes not sent yet, and are skipped when there are none.
  const prior = await alertedChanges(channel, group);
  const key = `rollout:${channel}:${group}:${rollouts.map((r) => String(r._id)).sort()[0]}`;
  const base = { key, kind: "rollout", channel, group };
  const messages = [];
  const fromHere = await alertsFromChannel(channel, group, ctx.flagsChanged);

  // A loader-flags-changed event is news even in a build that was alerted on before (same build, new flags).
  const updateSeverity = (changes) => (ctx.flagsChanged ? "high" : maxSeverity(changes.map((c) => c.severity)));
  const slackChanges = prior ? newChanges(ctx.changes, prior) : ctx.changes;
  if (fromHere && (!prior || slackChanges.length || ctx.flagsChanged)) {
    const severity = prior ? updateSeverity(slackChanges) : ctx.severity;
    const { text } = renderAlert(ctx, { changes: slackChanges, severity, unsubscribe: "", watched: false, update: !!prior });
    const head = text.split("\n")[0];
    const notice = ctx.notice ? [ctx.notice] : [];
    messages.push({ ...base, transport: "slack", subscriberId: null, message: { text: [head, ...notice, ...summarizeApi(slackChanges, 15), ctx.url].join("\n") } });
  }

  const { deliveries, rollouts: rolloutCol } = await db();
  const alerted = new Set(
    (await deliveries.distinct("subscriberId", { kind: "rollout", channel, group, transport: "email" })).map(String),
  );
  const subscribers = fromHere ? await activeSubscribers(channel) : [];
  for (const sub of subscribers) {
    const watches = watchesOf(sub);
    const relevant = matchingChanges(watches, ctx.changes);
    // "Update" in the subject only for those who got the first email; once the group was alerted on, every
    // later email carries only changes not sent before (also to someone who subscribed in between, and for
    // groups alerted before the delivery queue existed, which have no rows to tell who got what).
    const update = alerted.has(String(sub._id));
    let changes = relevant;
    let severity;
    if (prior) {
      changes = newChanges(relevant, matchingChanges(watches, prior));
      if (changes.length === 0 && !ctx.flagsChanged) continue;
      severity = updateSeverity(changes);
    } else {
      // With a watchlist only matching API changes count; without one, any rollout that changed the API.
      // A loader-flags-changed event concerns every add-in, watchlist or not.
      if (watches.length && relevant.length === 0 && !ctx.flagsChanged) continue;
      if (!watches.length && !emailWorthy(ctx)) continue;
      severity = watches.length && !ctx.flagsChanged ? maxSeverity(relevant.map((c) => c.severity)) : ctx.severity;
    }
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[sub.minSeverity ?? "low"]) continue;

    const unsubscribe = unsubscribeUrl(sub);
    messages.push({
      ...base,
      transport: "email",
      subscriberId: sub._id,
      to: sub.email,
      message: {
        headers: unsubscribeHeaders(unsubscribe),
        ...renderAlert(ctx, { changes, severity, unsubscribe, watched: watches.length > 0, update }),
      },
    });
  }

  await enqueue(messages);
  await rolloutCol.updateMany({ _id: { $in: rollouts.map((r) => r._id) } }, { $set: { notifiedAt: new Date() } });
}

/** Subject, text and HTML of one subscriber's rollback alert. */
function renderRollback(ctx, items, { changes, unsubscribe, watched }) {
  const entries = apiEntries(changes);
  const limit = 25;
  const peakShare = Math.max(0, ...items.map((r) => r.peakShare ?? 0));
  const firstSeenAt = new Date(Math.min(...items.map((r) => new Date(r.firstSeenAt).getTime())));
  const { uniqueApiChanges } = countChanges(changes);
  const line =
    `Office.js ${ctx.channel}: ${ctx.toBuild ? `build ${ctx.toBuild}` : ctx.title} pulled back — no sampled edge has ` +
    `served it for 24 h (${items.length} file(s), peak ~${pct(peakShare)} of edges, ${plural(uniqueApiChanges, "API change")} reverted)`;
  return {
    line,
    subject: `[pulled back] Office.js ${ctx.channel}: ${ctx.toBuild ? `build ${ctx.toBuild}` : ctx.title} rolled back`,
    text: [
      line,
      "",
      ...summarizeApi(changes, limit),
      "",
      ctx.url,
      "",
      `Unsubscribe: ${unsubscribe}`,
      `Support silentship: ${SUPPORT_URL}`,
    ].join("\n"),
    html: rollbackEmail({
      channel: ctx.channel,
      title: ctx.title,
      fromBuilds: ctx.fromBuilds,
      files: items.length,
      peakShare,
      firstSeenAt,
      totalChanges: uniqueApiChanges,
      entries: entries.slice(0, limit),
      more: Math.max(0, entries.length - limit),
      url: ctx.url,
      unsubscribe,
      watched,
    }),
  };
}

/**
 * A pulled-back build always alerts — also without API changes and below minSeverity: the add-in is
 * suddenly back on the previous code. Watchlist subscribers only when the build touched a watched API.
 */
async function notifyRollback(channel, group, items) {
  const ctx = await groupContext(channel, group, items);
  const base = { key: `rollback:${channel}:${group}`, kind: "rollback", channel, group };
  const { line } = renderRollback(ctx, items, { changes: ctx.changes, unsubscribe: "" });
  const fromHere = await alertsFromChannel(channel, group, ctx.flagsChanged);
  const messages = fromHere
    ? [{ ...base, transport: "slack", subscriberId: null, message: { text: [line, ctx.url].join("\n") } }]
    : [];
  const subscribers = fromHere ? await activeSubscribers(channel) : [];
  for (const sub of subscribers) {
    const watches = watchesOf(sub);
    const relevant = matchingChanges(watches, ctx.changes);
    if (watches.length && relevant.length === 0) continue;
    const unsubscribe = unsubscribeUrl(sub);
    const { line: _line, ...email } = renderRollback(ctx, items, { changes: relevant, unsubscribe, watched: watches.length > 0 });
    messages.push({
      ...base,
      transport: "email",
      subscriberId: sub._id,
      to: sub.email,
      message: { headers: unsubscribeHeaders(unsubscribe), ...email },
    });
  }
  await enqueue(messages);
  const { rollouts: rolloutCol } = await db();
  await rolloutCol.updateMany({ _id: { $in: items.map((r) => r._id) } }, { $set: { rollbackNotifiedAt: new Date() } });
}

/**
 * Sends a sample of every email to one address, built from the newest, most severe stored rollout group:
 * the real alert layout with real data, but dummy confirm/unsubscribe tokens. Marks nothing as notified.
 */
export async function sendPreviewEmails(to) {
  const { rollouts: rolloutCol, apiChanges } = await db();
  const [newest] = await listGroups({ limit: 1, severity: "high" }).then((g) =>
    g.length ? g : listGroups({ limit: 1 }),
  );
  if (!newest) throw new Error("No rollouts in the database to build a preview from");
  const rollouts = await rolloutCol
    .find({ channel: newest.channel, group: newest.group, region: config.region })
    .toArray();
  const rows = await apiChanges.find({ rolloutId: { $in: rollouts.map((r) => r._id) } }).toArray();
  const withChanges = rollouts.map((r) => ({ ...r, apiChanges: rows.filter((c) => c.rolloutId.equals(r._id)) }));
  const ctx = await groupContext(newest.channel, newest.group, withChanges);
  const unsubscribe = `${config.publicUrl}/unsubscribe?token=preview`;
  const alert = renderAlert(ctx, { changes: ctx.changes, severity: ctx.severity, unsubscribe, watched: false });
  const confirm = confirmEmail({ link: `${config.publicUrl}/confirm?token=preview`, channels: ["prod", "beta"] });
  const { line, ...rollback } = renderRollback(ctx, withChanges, { changes: ctx.changes, unsubscribe, watched: false });
  for (const email of [confirm, alert, rollback])
    await sendEmail({ to, ...email, subject: `[preview] ${email.subject}` });
  return { channel: newest.channel, group: newest.group, changes: ctx.changes.length, emails: 3 };
}
