# TECH.md — silentship

The single source of truth for **what** silentship does, where its limits are and **why** it is built the
way it is. How the code works, module by module, is in [`docs/architecture/`](docs/architecture/README.md).

## 0. The problem and an honest scope

Office.js is loaded from a fixed URL (`/lib/1/hosted/office.js`), but the code behind it changes without
versions, a changelog or SRI hashes. Self-hosting is not an option: Microsoft requires the CDN, and the
loader pulls in its dependencies dynamically. The pain is well documented in the open letter
[OfficeDev/office-js#6513](https://github.com/OfficeDev/office-js/issues/6513) (February 2026): an analysis
of ~6,200 issues in the repository, ~233 developers who discussed abandoning the platform in them, and an
estimated $6.1–9.1M cost from filed issues alone.

**Scope:** many breakages happen not in the JavaScript on the CDN but inside the native host (Outlook
Classic/New, Excel win32, desktop vs. web differences). A CDN monitor **cannot see** those. So the promise
is: "you learn about changes to the JavaScript layer of Office.js within the hour, not from customers weeks
later, and you can quickly tell whether the CDN is to blame" — not "we catch every breaking change". The
same limit is stated in the site footer and in `llms.txt`.

**Timing, honestly:** a new version shows on the site after the next crawl (every 10 minutes). An alert
waits until the version has been seen in two runs and the channel has been quiet for 20 minutes — typically
30–40 minutes after the first sighting. Microsoft rolls out over hours and days, so this is fast enough; do
not promise "within minutes" for alerts.

## 1. Stack (as built)

| What | Choice | Why |
|---|---|---|
| Runtime | Node.js ≥ 22, plain JavaScript (ESM), no build step for the backend | Small codebase; the Node permission model used by the sandbox needs ≥ 22 |
| Monorepo | npm workspaces: `backend/`, `frontend/` | One `.env`, one deploy; the two talk only over HTTP, so either can be split out |
| Scheduling | `node-cron` inside the backend process on a VPS | GitHub Actions cron starts late, and a monitor needs a steady interval |
| Metadata, subscribers | MongoDB, official `mongodb` driver, no ORM | Document-shaped rollouts and API changes; no multi-document transactions needed |
| Code archive | Private git repository `data/archive`: content-addressed `blobs/<sha256>` + formatted newest version | The same sha is never stored twice; `git log -p` reads as a changelog |
| API surface | **Runtime reflection**: the file runs in `node:vm` inside an isolated child process; `@babel/parser` only parses the loader and normalizes function bodies | Minified code does not give back the class tree statically ([`api-surface.md`](docs/architecture/api-surface.md)) |
| API status | `@types/office-js` and `@types/office-js-preview` | GA / preview / undocumented and requirement set for every change |
| Formatting | prettier | Readable diffs in the archive |
| Web API | Fastify on `127.0.0.1:4000` | Only behind the frontend, no CORS |
| Site | Next.js 16 (App Router), React 19, SSR | Indexable rollout pages, live updates over SSE |
| Email | Brevo transactional API | Without a key, emails are printed to the log |
| Other alerts | Slack incoming webhook | — |
| Analytics | Umami Cloud (no cookies) | [`analytics.md`](docs/architecture/analytics.md) |
| Deploy | One VPS: nginx + systemd, GitHub Actions deploys on push to `main` | [`docs/SETUP.md`](docs/SETUP.md) |

Not built yet (see §4): Discord/Teams/Telegram, a generic webhook, GitHub `repository_dispatch`.

## 2. Architecture decisions

### A. CDN crawler

The loader picks the host file from `_host_Info` (from `window.external.GetHostInfo()`, the query string,
`window.name` or `sessionStorage`), not from the User-Agent. File names come from the
`OSF.HostSpecificFileVersionMap` table inside the loader, so spoofing a User-Agent achieves nothing.

1. Fetch the channel's `office.js` (`prod` → `/lib/1/hosted/`, `beta` → `/lib/beta/hosted/`).
2. Read `OSF.HostSpecificFileVersionMap` from it (AST, nothing executed) and generate the full list of host
   files (`excel-win32-16.01.js`, `outlook-web-16.00.js`, …). The matrix comes from the loader itself, so new
   hosts and platforms appear automatically.
3. Add the dependencies: `o15apptofilemappingtable.js`, `{locale}/office_strings.js` (`en-us` by default),
   `telemetry/oteljs_agave.js`, `microsoftajax.js`.
4. **Build stamp** (`OSF.ConstantNames.FileVersion`, e.g. `16.0.20606.15070`) groups the files of one
   release but is **not the primary signal**: host files change without a new build number. The primary
   signal is the sha256 of every file.
5. **HTTP metadata:** `Last-Modified`, `Akamai-Request-BC` (edge IP and location), `Akamai-Cache-Status`,
   `X-CDN-Provider`, `x-ms-request-id`. The CDN sends no ETag.
6. **Several samples per file:** Akamai edges serve different versions at the same time, so every file is
   requested `SAMPLES` times on fresh connections, and a change is a **rollout** with a share of edges, not
   a single "changed" event.
7. **The beta channel** is watched in parallel: beta changes often precede production.
8. **Several regions** (EU/US/Asia) are planned. All data already carries a `region` tag (`REGION`), but the
   crawler runs from one VPS.

### B. Change analysis

1. New sha → blob into the archive → prettier version into the archive → `git commit`.
2. **API-surface diff** — the core: the tree of public namespaces and members (`Office.*`, `Excel.*`,
   `Word.*`, `PowerPoint.*`, `OneNote.*`, `Visio.*`, `Outlook`, DDA method names) with arity, enum values and
   a hash of the normalized function body. Trees are compared, not text.
3. **Severity:**
   - `High` — a public GA member disappeared, its type or arity changed, an enum value was removed or changed; a file was deleted.
   - `Medium` — the body of a public GA function changed (not its signature).
   - `Low` — new API, preview and undocumented APIs, class constructors, strings, telemetry, a new file.
4. **Watchlist:** a subscriber lists the APIs their add-in uses (`Office.context.ui.displayDialogAsync`,
   `Excel.Range.*`) and is alerted only about changes that touch them — the main defence against noise.
   Today entries are added from the CLI (`npm run watch`); there is no UI yet.
   Without a watchlist, email goes out only for rollouts that changed the public API or are High, and only
   once a version has been seen in two runs: a build with zero API changes is noise for add-in developers,
   and a one-run sighting is a short CDN incident rather than a release (kept in the data, see PLAN).
   A confirmed build that every edge stops serving for 24 hours is a rollback and **always** alerts.
   The site follows the same confirmation rule: an unconfirmed sighting is not shown as a rollout.
5. An ES5/IE11 check is low priority: it only matters for old MSI builds of Office with the Trident WebView.

### C. Customer tests (later phases)

Playwright against Office Online as the core of the product is unrealistic:
- Office Online needs a login to an M365 tenant (MFA, conditional access), and automating Office's web UI is brittle.
- Desktop hosts (win32, Mac), where it hurts most, cannot be tested with Playwright at all.
- Customers would have to hand over their add-in and test-tenant credentials — a blocker for any enterprise.
- Swapping in "just updated" files tests nothing: they are already in production.

**Instead — trigger the customer's CI:** on a CDN change, send `repository_dispatch` to the customer's
GitHub (or a webhook). Their own E2E suite runs in their CI with their credentials. We never touch secrets,
and they get "tests ran 10 minutes after Microsoft's release". Plus a ready-made GitHub Action template.

**Later — bisection:** when a customer test fails, run it twice with Office.js swapped via `page.route`: the
previous version from our archive vs. the current one. If it passes with the old one and fails with the
new, the CDN is to blame, and the customer has evidence ready for an issue with Microsoft.

### D. Issue correlation (later)

Watch new issues in `OfficeDev/office-js` (GitHub API) and match them with releases: "after build 16.0.20606,
four issues about `displayDialogAsync` appeared". Cheap, and it adds context that a raw diff does not have.

## 3. What is published

The site, RSS, `llms.txt` and this repository contain **only metadata and API-surface diffs** — paths,
arity, enum values, build numbers, shares. Microsoft's code (raw or formatted) lives only in the private
archive on the server and is never committed here; tests use synthetic fixtures.

## 4. Roadmap

| Phase | Scope | State |
|---|---|---|
| 0 | Crawler, build stamp, public changelog, RSS | Done |
| 1 | API-surface diff, severity, watchlist, Slack/email, beta channel | Done, except the watchlist UI |
| 1.5 | Customer CI trigger + GitHub Action template, multi-region | Not started |
| 2 | Playwright bisection, issue correlation | On demand |

Open items in detail — [`docs/tasks/PLAN.md`](docs/tasks/PLAN.md).

## 5. Technical risks

- **Coverage:** native host breakages are invisible to a CDN monitor (§0). For Outlook, reflection sees
  classes, enums and DDA method names, but not the full `Office.context.mailbox.item` tree.
- **CDN behaviour changes:** the design relies on observed CDN behaviour
  ([`cdn-facts.md`](docs/architecture/cdn-facts.md)). If Microsoft adds ETags, query-based versioning or a
  different provider, the crawler has to follow.
- **Running remote code:** reflection executes code downloaded from the CDN. It runs only in a locked-down
  child process ([`api-surface.md`](docs/architecture/api-surface.md), [`SECURITY.md`](SECURITY.md)).
