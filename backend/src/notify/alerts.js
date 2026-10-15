import { config } from "../config.js";
import { db } from "../db.js";
import { maxSeverity, SEVERITY_RANK } from "../analysis/diff.js";
import { matchingChanges } from "../analysis/watchlist.js";
import { hostTypeOf } from "../crawler/manifest.js";
import { listGroups } from "../web/queries.js";
import { alertEmail, confirmEmail } from "./email-templates.js";
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

async function findPending() {
  const { rollouts, apiChanges } = await db();
  const pending = await rollouts
    .find({ notifiedAt: null, status: { $ne: "abandoned" } }, { sort: { firstSeenAt: 1 }, projection: { history: 0 } })
    .toArray();
  if (pending.length === 0) return [];
  const rows = await apiChanges.find({ rolloutId: { $in: pending.map((r) => r._id) } }).toArray();
  return pending.map((r) => ({ ...r, apiChanges: rows.filter((c) => c.rolloutId.equals(r._id)) }));
}

/**
 * A Microsoft release reaches the host files one by one over several crawls. Alerts wait until a channel
 * has had no new rollout for `quietMinutes`, then go out as one message per target build.
 */
/** Unconfirmed sign-ups are deleted after 30 days; we keep no address the owner did not confirm. */
export async function pruneUnconfirmed(now = new Date()) {
  const { subscribers } = await db();
  const { deletedCount } = await subscribers.deleteMany({
    confirmedAt: null,
    createdAt: { $lt: new Date(now.getTime() - 30 * 24 * 3600_000) },
  });
  return deletedCount;
}

export async function notifyPending(quietMinutes = config.alertQuietMinutes, now = new Date()) {
  const byChannel = new Map();
  for (const r of await findPending()) byChannel.set(r.channel, [...(byChannel.get(r.channel) ?? []), r]);

  for (const [channel, rollouts] of byChannel) {
    const latest = rollouts[rollouts.length - 1];
    if (now.getTime() - latest.firstSeenAt.getTime() < quietMinutes * 60_000) continue;
    const byGroup = new Map();
    for (const r of rollouts) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    for (const [group, items] of byGroup) await notifyGroup(channel, group, items);
  }
}

/** Everything an alert about one rollout group needs, computed once for Slack and every subscriber. */
async function groupContext(channel, group, rollouts) {
  const url = `${config.publicUrl}/rollouts/${channel}/${encodeURIComponent(group)}`;
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
    `Office.js ${channel}: ${what} [${severity}] — ${files} file(s), on ~${pct(share)} of sampled edges, ` +
    `${changes.length} API change(s)`;
  const title = toBuild ?? (removed ? "Files removed" : "Unversioned change");
  return {
    channel,
    url,
    changes,
    severity,
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

/** Subject, text and HTML of one subscriber's alert. */
function renderAlert(ctx, { changes, severity, unsubscribe, watched }) {
  const entries = apiEntries(changes);
  const limit = 25;
  return {
    subject: `[${severity}] Office.js ${ctx.channel}: ${ctx.toBuild ? `build ${ctx.toBuild} rolling out` : ctx.what}`,
    text: [ctx.header, "", ...summarizeApi(changes, limit), "", ctx.url, "", `Unsubscribe: ${unsubscribe}`].join("\n"),
    html: alertEmail({
      channel: ctx.channel,
      title: ctx.title,
      fromBuilds: ctx.fromBuilds,
      severity,
      status: ctx.status,
      files: ctx.files,
      share: ctx.share,
      totalChanges: changes.length,
      entries: entries.slice(0, limit),
      more: Math.max(0, entries.length - limit),
      url: ctx.url,
      unsubscribe,
      watched,
    }),
  };
}

async function notifyGroup(channel, group, rollouts) {
  const ctx = await groupContext(channel, group, rollouts);

  try {
    await postSlack([ctx.header, ...summarizeApi(ctx.changes, 15), ctx.url].join("\n"));
  } catch (err) {
    console.error(`Slack notification failed for ${channel}/${group}: ${String(err)}`);
  }

  const { rollouts: rolloutCol, subscribers: subscriberCol } = await db();
  const subscribers = await subscriberCol
    .find({ confirmedAt: { $ne: null }, unsubscribedAt: null, channels: channel })
    .toArray();

  for (const sub of subscribers) {
    const watches = (sub.watchItems ?? []).map((w) => ({ pattern: w.pattern, hosts: w.hosts ?? [] }));
    const relevant = matchingChanges(watches, ctx.changes);
    // With a watchlist only matching API changes count; without one, any rollout does.
    if (watches.length && relevant.length === 0) continue;
    const subSeverity = watches.length ? maxSeverity(relevant.map((c) => c.severity)) : ctx.severity;
    if (SEVERITY_RANK[subSeverity] < SEVERITY_RANK[sub.minSeverity ?? "low"]) continue;

    const unsubscribe = `${config.publicUrl}/unsubscribe?token=${sub.token}`;
    try {
      await sendEmail({
        to: sub.email,
        // Gmail/Yahoo bulk-sender rules: one-click unsubscribe (RFC 8058).
        headers: {
          "List-Unsubscribe": `<${unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        ...renderAlert(ctx, { changes: relevant, severity: subSeverity, unsubscribe, watched: watches.length > 0 }),
      });
    } catch (err) {
      console.error(`Email to subscriber ${sub._id} failed: ${String(err)}`);
    }
  }

  await rolloutCol.updateMany({ _id: { $in: rollouts.map((r) => r._id) } }, { $set: { notifiedAt: new Date() } });
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
  for (const email of [confirm, alert]) await sendEmail({ to, ...email, subject: `[preview] ${email.subject}` });
  return { channel: newest.channel, group: newest.group, changes: ctx.changes.length };
}
