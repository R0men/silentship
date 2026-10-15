# Subscriptions, watchlist and alerts

Code: `POST /api/subscribe`, `/confirm`, `/unsubscribe` — `backend/src/web/server.js`; sending —
`backend/src/notify/alerts.js` (`notifyPending`, `pruneUnconfirmed`, `sendPreviewEmails`); delivery —
`backend/src/notify/senders.js`; email HTML — `backend/src/notify/email-templates.js`; matching —
`backend/src/analysis/watchlist.js`.

## Subscription (double opt-in)

- The form (`frontend/components/Subscribe.js`) sends `{ email, beta }`. `beta: true` → channels `prod,beta`,
  otherwise `prod`. `minSeverity` defaults to `low`; there is no UI for it or for the watchlist yet.
- A confirmation email with a `/confirm?token=…` link; after confirming, a redirect to `/?notice=confirmed`.
- **Abuse protection:** 5 requests per hour per IP; at most 3 confirmation emails per address per day; a
  global cap `MAX_CONFIRMATIONS_PER_HOUR` (200). The response is the same whether the address is known or
  not, so the form does not leak subscribers. The IP comes from `X-Forwarded-For`, trusting loopback proxies
  only (`TRUST_PROXY`), and nginx overwrites that header with the real address.
- A previously unsubscribed address submitted again must confirm again; a confirmed one keeps its settings.
- Unconfirmed addresses are deleted after 30 days (`pruneUnconfirmed`, after every crawl).
- Unsubscribe: `GET /unsubscribe?token=…` (the link in emails) and `POST /unsubscribe` — one-click
  unsubscribe per RFC 8058; alert emails carry `List-Unsubscribe` + `List-Unsubscribe-Post`.

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
changes only. Without a watchlist — any rollout of the channel. Then the `minSeverity` filter applies.

## Alert batching

A new version reaches the host files one by one over several runs. An alert goes out once the channel has
had no new rollouts for `ALERT_QUIET_MINUTES` (20 min): one message per target build — how many files, what
share of edges, which API changes (one line per path with the list of files). Sent rollouts get `notifiedAt`.

## What the emails look like

`email-templates.js`: `confirmEmail` (double opt-in) and `alertEmail` (rollout) in the site's style — dark
`#060607` background, white as the only bright accent (button, headline number, share bar), severity
colours (`#ff5b6b` / `#f2b544` / grey), API paths in a monospace font. Email clients ignore `<style>`, web
fonts and flexbox unevenly, so the layout is nested tables with inline styles, colours are repeated as
`bgcolor` attributes, the width is ≤ 560 px, and a hidden preheader sets the inbox preview line. Every email
also has a plain-text part.

An alert shows: severity and channel, the build, a sentence about the release (past tense when complete),
edge share with a bar, files / API changes / status, up to 25 changes (one per path, with hosts; "… and N
more"), a button to the rollout page and a footer with the unsubscribe link. Change kinds are spelled out
("enum values changed" instead of `enumChanged`).

**Preview with real data** (the newest high-severity group, dummy tokens, nothing marked as sent):

```sh
node backend/src/cli.js mail-preview you@example.com
```

It needs `BREVO_API_KEY`, so run it where that key is set (on the server).

## Delivery channels

- **Email** — Brevo transactional API (`POST /v3/smtp/email`), sender `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME`;
  in production `silentship <alerts@silentship.dev>`. Without `BREVO_API_KEY` the email is printed to the
  log (development). DNS for deliverability — `docs/SETUP.md`.
- **Slack** — `SLACK_WEBHOOK_URL`, one message per build for the whole channel (not per subscriber).
