# Backend web API

Code: `backend/src/web/server.js` (Fastify, routes), `queries.js` (read models), `live.js` (SSE). Listens on
`API_HOST:API_PORT` (`127.0.0.1:4000`); reachable from outside only through the frontend's proxy.

## Routes

| Route | What | Proxied by Next |
|---|---|---|
| `GET /health` | 200/503 for uptime monitors: every channel finished a run within `HEALTH_STALE_MINUTES` (20), the last run did not fail, none has been running for more than twice that (40 min) | `/health` |
| `GET /api/overview` | Per channel: stable build, last run, active groups; 30-day stats (distinct builds, and builds or other changes with High severity — not groups) | `/api/*` |
| `GET /api/rollouts?channel&severity&before&limit` | Rollout groups, newest first; `before` is a `firstSeenAt` cursor; `limit` 1–100 (30) | `/api/*` |
| `GET /api/rollouts/:channel/:group` | One group with hosts, share history and API changes (the same `Office.*` change from several files is one row with the file list) | `/api/*` |
| `GET /api/sitemap` | Keys and dates of every rollout page for `/sitemap.xml` ([`seo.md`](seo.md)) | `/api/*` |
| `GET /api/live` | Server-Sent Events, see below | `/api/*` |
| `GET /rss.xml` | RSS 2.0, the 50 newest groups | `/rss.xml` |
| `POST /api/subscribe`, `GET\|POST /confirm`, `GET\|POST /unsubscribe` | Subscriptions; GET only shows a page with a button, POST changes state ([`alerts.md`](alerts.md)) | yes |

## The single source of numbers

The share and file count of a group are computed only by `listGroups` (`queries.js`, one aggregate). The
headline, channel cards, list, rollout page, live updates, RSS and alerts all take their numbers from it.
It returns **confirmed groups only** — the same rule as alerts (`CONFIRM_RUNS` in `pipeline/rollouts.js`,
[`alerts.md`](alerts.md)): a group sighted in a single run is a CDN incident, not a rollout, and appears
nowhere on the site (list, cards, headline, stats, rollout page → 404, RSS, sitemap). If it never comes
back it is abandoned after 24 h and stays hidden. Definitions:
- `files` — files that are rolling out or complete; pulled-back files are counted separately (`abandonedFiles`);
- `share` — the mean over those files of the smoothed per-file share (over 6 runs), a completed file counting as 100%.

`sitemapGroups` for the sitemap is deliberately a separate, light query: keys and dates only, none of these numbers
(it applies the same confirmation filter).

## Live updates (SSE)

`/api/live`: every 5 s the backend looks at the newest run in the database (this also works when the crawl
runs in a separate process). When a run starts or finishes, every client gets a snapshot `{ overview,
rollouts }` (`event: update`); a new client gets one immediately on connect. A `: ping` comment every 25 s
keeps the connection alive; nginx does not buffer this route (`deploy/nginx-silentship.conf`). Next proxies
the stream without buffering (verified).
