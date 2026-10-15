# Architecture — index

How the code works, module by module — as opposed to [`../SETUP.md`](../SETUP.md) (running and deploying)
and [`../VERIFY.md`](../VERIFY.md) (manual checks). Product decisions, scope and roadmap are in
[`../../TECH.md`](../../TECH.md); this folder covers the implementation file by file.

Current scope: phase 0 and the core of phase 1 from `TECH.md` §4. Multi-region (only a `region` tag in the
data), the CI trigger, bisection, issue correlation and per-method SEO pages are out of scope.

## Modules

| File | About | Code |
|---|---|---|
| [`cdn-facts.md`](cdn-facts.md) | What we found on the real CDN and how it shaped the design | — |
| [`crawler.md`](crawler.md) | Loader → file manifest, samples on fresh connections, conditional requests, build stamps, HTTP metadata | `backend/src/crawler/*`, `backend/src/pipeline/run.js` |
| [`rollouts.md`](rollouts.md) | A rollout of one version of one file: edge share, stable/stale, completion, pull-back, groups by build | `backend/src/pipeline/rollouts.js`, `backend/src/pipeline/run.js` |
| [`api-surface.md`](api-surface.md) | API reflection in an isolated process, `bodyHash`, diff, severity, status from `@types`, renames | `backend/src/analysis/*` |
| [`alerts.md`](alerts.md) | Double opt-in subscriptions, watchlist, alert batching, email templates, Brevo and Slack | `backend/src/notify/*`, `backend/src/analysis/watchlist.js`, `backend/src/web/server.js` |
| [`data.md`](data.md) | MongoDB collections and indexes, the git archive | `backend/src/db.js`, `backend/src/archive/git-archive.js` |
| [`web.md`](web.md) | JSON API, RSS, SSE `/api/live`, `/health`, the single source of numbers | `backend/src/web/*` |
| [`frontend.md`](frontend.md) | The Next.js site: pages, proxy to the backend, live updates, design | `frontend/*` |
| [`seo.md`](seo.md) | Metadata, canonical URLs, Open Graph, generated `sitemap.xml`, `robots.txt`, `llms.txt` | `frontend/app/{layout,page,sitemap,robots,opengraph-image}.js`, `frontend/app/llms.txt/route.js`, `frontend/lib/site.js` |
| [`analytics.md`](analytics.md) | Umami: the script, the `subscribe` event, privacy | `frontend/app/layout.js`, `frontend/components/Subscribe.js` |

## One crawl (cron, every 10 minutes)

```
                ┌──────────── scheduler (node-cron, CRON) ─────────────┐
                ▼                                                       │
  sampler: loader × SAMPLES → union of manifests → every file × SAMPLES
                │  (new connection per sample, conditional requests, build from the text)
                ▼
  rollouts: tally (share of each version) → planFile → create / update / complete
                │
  archive (git): blobs/<sha> + surfaces/v2/<key>.json + <channel>/<region>/formatted/<file>
                │
  analysis: surface(from) vs surface(to) in an isolated process → diff → severity
                │
  db (MongoDB): fileStates, rollouts, apiChanges, snapshots, runs
                │
  notify: Slack + email (Brevo) per rollout group, with watchlists
                │
  backend/web (Fastify): JSON API + RSS + SSE on 127.0.0.1:API_PORT
                │
  frontend (Next.js): SSR pages, /api proxied to the backend
```

Channels run one after another (they share the git archive); then `notifyPending()` and
`pruneUnconfirmed()` (`backend/src/cli.js`).

## Invariants that cut across modules

- **Microsoft's code never reaches the site or this repository.** The site shows only metadata and
  API-surface diffs; raw code lives only in the private `data/archive` (`TECH.md` §3).
- **Code from the CDN runs only in the isolated worker** (`surface-runner.js`): empty environment, Node
  permission model, memory and time limits. Never execute it in the main process.
- **Rollout group numbers come only from `listGroups`** (`backend/src/web/queries.js`), so the site, RSS,
  SSE and alerts cannot show two different figures for one release ([`web.md`](web.md)).
- **The backend listens on localhost only**; browsers only ever see the frontend's origin.
