# Subscriptions, watchlist and alerts

Code: `POST /api/subscribe`, `/confirm`, `/unsubscribe` — `backend/src/web/server.js`; sending —
`backend/src/notify/alerts.js` (`notifyPending`, `flushDeliveries`, `pruneUnconfirmed`, `sendPreviewEmails`); delivery —
`backend/src/notify/senders.js`; email HTML — `backend/src/notify/email-templates.js`; matching —
`backend/src/analysis/watchlist.js`.

## Subscription (double opt-in)

- The form (`frontend/components/Subscribe.js`) sends `{ email, beta }`. `beta: true` → channels `prod,beta`,
  otherwise `prod`. `minSeverity` defaults to `low`; there is no UI for it or for the watchlist yet.
- A confirmation email with a `/confirm?token=…` link. **A GET never changes a subscription:** corporate
  mail gateways (Defender Safe Links, Mimecast) open every link in a message to scan it, which would confirm
  any address someone typed into the form and unsubscribe people. `GET /confirm` shows a page with a button
  (`web/action-page.js`); its `POST /confirm` confirms and redirects (303) to `/?notice=confirmed`.
- **Abuse protection:** 5 requests per hour per IP; at most 3 confirmation emails per address per day; a
  global cap `MAX_CONFIRMATIONS_PER_HOUR` (200). The response is the same whether the address is known or
  not, so the form does not leak subscribers. The IP comes from `X-Forwarded-For`, trusting loopback proxies
  only (`TRUST_PROXY`), and nginx overwrites that header with the real address.
- An address submitted again: a previously unsubscribed one must confirm again; an unconfirmed one gets the
  confirmation again. A confirmed one keeps its settings — if the form adds a channel it lacks (beta), the
  channels wait in `pendingChannels` and a confirmation email applies them on the button; otherwise it gets
  `alreadySubscribedEmail` ("You're already subscribed", with an unsubscribe link). So every submit sends
  an email and the form's "Check your inbox" is always true without revealing who is subscribed. The
  3-per-day limit covers all of these emails.
- Unconfirmed addresses are deleted after 30 days (`pruneUnconfirmed`, after every crawl).
- Unsubscribe: `GET /unsubscribe?token=…` (the link in emails) shows a page with a button; `POST
  /unsubscribe` unsubscribes. A POST whose body is `List-Unsubscribe=One-Click` (RFC 8058, sent by mail
  clients from the `List-Unsubscribe` + `List-Unsubscribe-Post` headers of every alert) gets a plain 200;
  the button gets a redirect to `/?notice=unsubscribed`.

## Watchlist

An entry is a `pattern` (`Office.context.ui.displayDialogAsync`, `Excel.Range.*`) plus an optional host
filter (`excel`, `outlook`). For now it is added from the CLI only:

```sh
npm run watch -w backend -- you@company.com "Excel.Range.*" excel
```

Matching (`matchesWatch`), case-insensitive:
- exact path;
- a `.*` wildcard — any change inside it;
- an ancestor was removed or changed kind (if `Excel.Range` is gone, that affects `Excel.Range.applyFilter`);
- a change in the DDA name registry for the watched method: `Office.context.ui.displayDialogAsync` hangs
  off runtime objects we cannot reflect, but its name is listed in `OSF.DDA.AsyncMethodNames`.

A subscriber with a watchlist is alerted only on a match, and the severity is computed over the matching
changes only. Without a watchlist — any rollout of the channel **that changed the public API, or is High**
(e.g. a removed file); a new build with zero API changes is not worth an email (`emailWorthy`). Then the
`minSeverity` filter applies. Slack gets every confirmed group regardless.

## Alert batching

**Confirmation first.** A group may alert as a rollout only once one of its files has been sighted in at
least `CONFIRM_RUNS` (2) runs, or has completed (`groupConfirmed`). A single-run sighting is a short CDN
incident, not a release: on 2026-10-15 at 16:16 UTC five of eight edges returned 404 for
`onenote-winrt-16.00.js` — OneNote add-ins on Windows served by those edges would not have loaded — and
every run after served the file again. Before this rule that produced a "files removed" (High) alert, which
was wrong as a *rollout* alert. Unconfirmed groups stay pending and, if never seen again, are abandoned
after 24 h without an alert; the site applies the same rule and never shows them (`listGroups`,
[`web.md`](web.md)). **The data is kept** (the rollout document with its share history; per-run
samples in `snapshots`, TTL 90 days) — surfacing such incidents is planned (`docs/tasks/PLAN.md`, #10).

**Rollbacks always alert.** When every file of a confirmed group has been abandoned (no sampled edge has
served it for 24 h), Microsoft pulled the build back (`groupRolledBack`). `notifyRollback` sends a
"pulled back" email to every subscriber of the channel — also when the build changed no API and regardless
of `minSeverity` — and a Slack line; watchlist subscribers only when the build touched a watched API. The
group gets `rollbackNotifiedAt`, so it alerts once. Only groups abandoned within the last 7 days are
considered. A one-run incident is never confirmed, so it never produces a rollback alert either.

A new version reaches the host files one by one over several runs (prod 16.0.20606: 14 files, then 26). An
alert goes out once the channel has had no new rollouts for `ALERT_QUIET_MINUTES` (20 min): one message per
target build — how many files, what share of edges, which API changes (one line per path with the list of
files). Alerted rollouts get `notifiedAt`.

**One alert per build, then updates.** Files of a build that reach the CDN after its alert are a new batch
of the same group. A subscriber who already got an email about the group (a `deliveries` row) gets an
**update** only if the batch brought API changes (by path and kind, after their watchlist) that earlier
batches did not — the email lists only those, the subject ends with "— update, N new API change(s)".
Otherwise the batch is marked notified silently. Once a group has been alerted on, every later email about it
carries only changes not sent before — also to someone who subscribed in between, and for groups alerted
before the queue existed. Slack gets the same: one line per build, then updates
only with new changes.

## Delivery queue

Alerts are not sent inline: `notifyGroup` and `notifyRollback` render every message and insert it into
`deliveries` (one row per recipient — subscriber email or the Slack webhook — unique by `key` + transport +
subscriber, so a re-run does not queue twice), then mark the rollouts. `flushDeliveries` runs at the end of
`notifyPending` after every crawl: it sends whatever is queued; a failure (Brevo or Slack down) stays queued
with `attempts` and `lastError` and is retried on the next crawl, up to `MAX_ATTEMPTS` (24, about four
hours), then gets `failedAt`. An email to a subscriber who unsubscribed in the meantime is dropped. Rows
expire after 90 days (TTL).

## What the emails look like

`email-templates.js`: `confirmEmail` (double opt-in), `alertEmail` (rollout) and `rollbackEmail` (pulled back) in the site's style — dark
`#060607` background, white as the only bright accent (button, headline number, share bar), severity
colours (`#ff5b6b` / `#f2b544` / grey), API paths in a monospace font. Email clients ignore `<style>`, web
fonts and flexbox unevenly, so the layout is nested tables with inline styles, colours are repeated as
`bgcolor` attributes, the width is ≤ 560 px, and a hidden preheader sets the inbox preview line. Every email
also has a plain-text part.

An alert shows: severity and channel, the build, a sentence about the release (past tense when complete),
edge share with a bar, files / API changes / status, up to 25 changes (one per path, with hosts; "… and N
more"), a button to the rollout page and a footer with the unsubscribe link. Change kinds are spelled out
("enum values changed" instead of `enumChanged`).

**Preview with real data** (the newest high-severity group — confirmation, rollout and rollback emails;
dummy tokens, nothing marked as sent):

```sh
node backend/src/cli.js mail-preview you@example.com
```

It needs `BREVO_API_KEY`, so run it where that key is set (on the server).

## Delivery channels

- **Email** — Brevo transactional API (`POST /v3/smtp/email`), sender `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME`;
  in production `silentship <alerts@silentship.dev>`. Without `BREVO_API_KEY` the email is printed to the
  log (development). DNS for deliverability — `docs/SETUP.md`.
- **Slack** — `SLACK_WEBHOOK_URL`, one message per build for the whole channel (not per subscriber), plus
  updates with new API changes. Both go through the delivery queue.
