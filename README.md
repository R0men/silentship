# silentship

**See Office.js change on the CDN while it is still rolling out.**

[![CI](https://github.com/R0men/silentship/actions/workflows/ci.yml/badge.svg)](https://github.com/R0men/silentship/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live](https://img.shields.io/badge/live-silentship.dev-black)](https://silentship.dev)

Office add-ins load Office.js from `appsforoffice.microsoft.com/lib/1/hosted/office.js` (or, as Microsoft now
recommends, `officeapis.public.onecdn.static.microsoft/1/office.js`). The URL never changes, but the code
behind it does — with no version, no changelog and no SRI hash. When an add-in breaks overnight, nobody can
tell whether it was their release or Microsoft's.

silentship watches both endpoints, production and beta. It also reads the security-default flags of each
`office.js` (the new endpoint's loader stops loading MicrosoftAjax) and alerts if they change. Every 10 minutes it samples every Office.js file on several edge servers,
tracks each new build as a **rollout** (which files, what share of edges serve it, since when), diffs the
**public API surface** between versions, and publishes the result at
[silentship.dev](https://silentship.dev), in [RSS](https://silentship.dev/rss.xml) and as email/Slack alerts.

---

## How we see a rollout across edges

Microsoft does not flip Office.js everywhere at once. Akamai edges serve **different versions of the same
file at the same time** — in one city we saw `Last-Modified` dates of the 7th, 9th, 12th and 13th of October
side by side, and two loader builds (`16.0.20528` and `16.0.20606`) on different edges. A monitor that
fetches each file once would flap on every run. So silentship measures instead:

```
            ┌─ edge A ── 304 Not Modified ──► stable version
office.js ──┼─ edge B ── 200 + new body ────► sha 9f3c… (build 16.0.20606)   2 of 8 samples → 25%
 × 8 fresh  ├─ edge C ── 304 Not Modified ──► stable version
 connections└─ …
```

1. **The loader comes first.** `office.js` contains `OSF.HostSpecificFileVersionMap`; parsing it (never
   executing it) yields every host file the loader can request — `excel-win32-16.01.js`,
   `outlook-web-16.00.js`, … — so new hosts appear on their own.
2. **Eight samples per file, each on a new TCP/TLS connection.** Keep-alive would pin us to one edge; fresh
   connections land on different servers. No query strings: a cache-buster would hit the origin, which
   always has the newest version, and hide exactly what we want to measure.
3. **Conditional requests.** Every sample carries `If-Modified-Since` = the stable version's date. Edges
   that still serve it answer `304` with no body; only edges with something newer send bytes. A quiet run
   costs almost nothing; a baseline run is ~37 MB per channel.
4. **A version is a sha256, not a date or a build number.** Identical bytes come with different
   `Last-Modified` on different edges, and host files change without a new build stamp.
5. **Share → rollout state.** The share of samples serving a new sha is smoothed over six runs. 100% for
   three runs in a row → complete; no sightings for 24 hours → pulled back (revived if it returns).
6. **One Microsoft release = one page.** Rollouts of the same target build are grouped:
   [`/rollouts/prod/16.0.20606.15070`](https://silentship.dev/rollouts/prod/16.0.20606.15070) shows the
   share per host file and every API change.

Details: [`docs/architecture/cdn-facts.md`](docs/architecture/cdn-facts.md),
[`crawler.md`](docs/architecture/crawler.md), [`rollouts.md`](docs/architecture/rollouts.md).

## How we diff the API

Office.js is minified: `Excel.PivotField.applyFilter` is `n.prototype.applyFilter=function(e){…}` deep in a
closure, so static analysis cannot rebuild the class tree. silentship **executes** each version and reflects
the live objects instead — `Office`, `Excel`, `Word`, `PowerPoint`, `OneNote`, `Visio`, `Outlook` — into a
flat map of paths (≈5,000–5,500 for Excel and Word, ≈2,000 for PowerPoint) with kind, arity, enum values
and a minifier-proof body hash.

Running code from the internet is done carefully: a separate child process with an empty environment (no
secrets to read), the Node.js permission model (read-only access to its own code and the file under
analysis; no writes, child processes or native addons), a memory cap and a timeout. Each change is then
tagged GA / preview / undocumented from `@types/office-js`, and severity is kept honest: an incomplete
reflection never produces "removed", and preview APIs never go above Low.

Details: [`docs/architecture/api-surface.md`](docs/architecture/api-surface.md).

## What it cannot see

Breakages inside native hosts (Outlook, Excel win32, Mac) do not show up on the CDN. silentship tells you
when the JavaScript layer changed and what changed in it — not every way an add-in can break.

---

## Stack

| | |
|---|---|
| Monorepo | npm workspaces: `backend/`, `frontend/` |
| Backend | Node.js ≥ 22 (ESM, plain JS), Fastify 5, MongoDB driver 7, node-cron |
| Analysis | `node:vm` in a sandboxed child process, `@babel/parser`, prettier, `@types/office-js(-preview)` |
| Archive | private git repository of every file version seen (never published) |
| Site | Next.js 16 (App Router), React 19, SSR + Server-Sent Events |
| Alerts | Brevo (email), Slack webhook |
| Tests | Vitest, synthetic fixtures only |
| Deploy | GitHub Actions → SSH (forced command) → `deploy/deploy.sh` → systemd |

## Quick start

```sh
git clone https://github.com/R0men/silentship.git && cd silentship
npm install
cp .env.example .env
npm run dev      # backend on a throwaway in-memory MongoDB + next dev — no keys needed
npm test
```

Open http://localhost:3000. The first crawl starts immediately (~1 min per channel). Without
`BREVO_API_KEY`, confirmation and alert emails are printed to the backend log.

Production setup, environment variables and deployment: [`docs/SETUP.md`](docs/SETUP.md).

## Repository layout

```
backend/src/
  cli.js        crawl / serve / start / dev / watch / reclassify / mail-preview / subscribers
  crawler/      loader → manifest, sampling, build stamps, HTTP metadata
  pipeline/     one crawl of a channel, rollout rules
  analysis/     sandbox, reflection, body hash, diff, severity, watchlist
  archive/      private git archive
  notify/       alerts, email templates, Brevo, Slack
  web/          Fastify: JSON API, RSS, SSE, /health
frontend/app/   pages, sitemap.js, robots.js, llms.txt, Open Graph image
deploy/         deploy.sh, backup.sh, systemd units, nginx config
docs/           architecture, setup, verification, changelog, plan
TECH.md         scope, decisions, roadmap
```

## Documentation

| Document | About |
|---|---|
| [`TECH.md`](TECH.md) | The problem, scope, architecture decisions, roadmap |
| [`docs/architecture/`](docs/architecture/README.md) | How the code works, module by module |
| [`docs/SETUP.md`](docs/SETUP.md) | Local run, environment variables, deployment, DNS, backups |
| [`docs/VERIFY.md`](docs/VERIFY.md) | Manual checks for every component |
| [`docs/changelog/changelog.md`](docs/changelog/changelog.md) | Known issues and change history |
| [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md) | Agreed but not yet built |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md) | How to contribute, how to report a vulnerability |

## License

[MIT](LICENSE). silentship is not affiliated with Microsoft. This repository and the site contain metadata
and API-surface diffs only — no Microsoft code. "Office" and "Office.js" are trademarks of Microsoft.
