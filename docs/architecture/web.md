# Backend web API

Code: `backend/src/web/server.js` (Fastify, routes), `queries.js` (read models), `live.js` (SSE). Listens on
`API_HOST:API_PORT` (`127.0.0.1:4000`); reachable from outside only through the frontend's proxy.

## Routes

| Route | What | Proxied by Next |
|---|---|---|
| `GET /health` | 200/503 for uptime monitors: every channel finished a run within `HEALTH_STALE_MINUTES` (20), the last run did not fail, none has been running for more than twice that (40 min) | `/health` |
| `GET /api/overview` | Per track (`prod`, `beta`): stable build, last run, `endpoints` (legacy and OneCDN: build, last run), active releases, `latest` (the newest release, shown when nothing rolls); 30-day stats (distinct builds, and builds or other changes with High severity — not groups) | `/api/*` |
| `GET /api/home` | The home page in one call (`homeSnapshot`): `{ overview, rollouts, at }` — `/api/overview` plus the 30 newest releases; the same object `/api/live` pushes | `/api/*` |
| `GET /api/rollouts?channel&severity&before&limit` | Releases (`listReleases`), newest first; `channel` is the track; `before` is a `firstSeenAt` cursor; `limit` 1–100 (30) | `/api/*` |
| `GET /api/rollouts/:track/:group` | One release (`getRelease`): both `endpoints`, hosts, share history and API changes of the primary group (the same `Office.*` change from several files is one row with the file list), `differentFiles`, `notYetOn`, `flags` (the `loader-flags-changed` notice per endpoint, empty unless the flags changed), `loader`: `identical`, `flags-only` (same `bodyHashSansFlags`), `different`. 404 for a OneCDN channel | `/api/*` |
| `GET /api/types` | Every API type changed by a confirmed rollout (`listApiTypes`): channels, kinds, highest severity, dates | `/api/*` |
| `GET /api/types/:type` | One type's change history (`getApiType`): one event per group, path and kind with files and pulled-back files, related types; `type` in the reply is the canonical spelling | `/api/*` |
| `GET /api/sitemap` | Keys and dates of every rollout and API type page for `/sitemap.xml` ([`seo.md`](seo.md)) | `/api/*` |
| `GET /api/live` | Server-Sent Events, see below | `/api/*` |
| `GET /rss.xml` | RSS 2.0, the 50 newest releases (one item per track and build) | `/rss.xml` |
| `POST /api/subscribe`, `GET\|POST /confirm`, `GET\|POST /unsubscribe` | Subscriptions; GET only shows a page with a button, POST changes state ([`alerts.md`](alerts.md)) | yes |

## The single source of numbers

The share and file count of a group are computed only by `listGroups` (`queries.js`, one aggregate). The
headline, channel cards, list, rollout page, live updates, RSS and alerts all take their numbers from it.
It returns **confirmed groups only** — the same rule as alerts (`CONFIRM_RUNS` in `pipeline/rollouts.js`,
[`alerts.md`](alerts.md)): a group sighted in a single run is a CDN incident, not a rollout, and appears
nowhere on the site (list, cards, headline, stats, rollout page → 404, RSS, sitemap). If it never comes
back it is abandoned after 24 h and stays hidden. Definitions:
- `files` — files that are rolling out or complete; pulled-back files are counted separately (`abandonedFiles`);
- `share` — the mean over those files of the smoothed per-file share (over 6 runs), a completed file counting as 100%;
- `uniqueApiChanges` — API changes counted once per path and kind, however many host files carry them (the rows
  of the rollout page); `apiChangeFiles` — files carrying at least one. Every page leads with these: "5 API
  changes in 19 files". `apiChangeCount` is the per-file sum (the same change in 19 files counts 19) and stays
  for alerts. `apiCounts: false` skips the extra `apiChanges` query where nobody shows them (30-day stats).

`sitemapGroups` for the sitemap is deliberately a separate, light query: keys and dates only, none of these numbers
(it applies the same confirmation filter).

## Releases: one build of a track on both endpoints

The crawler and alerts work on groups of four channels (`prod`, `beta`, `onecdn-prod`, `onecdn-beta`); the
site works on **releases** (`listReleases`, `getRelease`, `sitemapReleases` in `queries.js`): one per track
(`prod`, `beta` — the legacy channel names) and group key, with `endpoints: { legacy, onecdn }`. Each side is
the endpoint's group summary, `{status: "stable"}` when the endpoint started on that build (its first run was
a baseline, so the build never was a rollout there — `fileStates.stableBuild`), or `null` (not seen).
- Numbers (files, share, API changes, severity, dates) are the legacy group's; the OneCDN one's when legacy
  has not shown the build. Filters (`severity`, `before`) apply to that primary group, so paging sees a
  release once; `activeOnly` keeps a release rolling on either endpoint.
- Files are compared only where **both endpoints serve this build** — the group's rollout there, or a stable
  version stamped with it. A file one endpoint still serves on an older build is not a difference but
  `notYetOn: { legacy, onecdn }` (a build seen on one endpoint only has all its files there). `differentFiles`
  are files of this build with other bytes on the two endpoints; `office.js` is left out, it always differs
  by the flags.
- `diverged` is true when `differentFiles` is not empty or the loader flags changed (`flagsChanged`).
- `onecdnCrawled` is false when `CHANNELS` has no OneCDN twin; then a release is just the legacy group.
- Group numbers still come only from `listGroups`; releases combine its results.

## API types (/reference)

A page per **type**, not per member: `apiTypeOf(path)` cuts a path at its last PascalCase segment after the
root (`Excel.Copilot.allowedUrls` → `Excel.Copilot`); a path without one belongs to its parent object
(`Office.context.document.getFileAsync` → `Office.context.document`), a two-segment one is its own type
(`Excel.run`). Members are anchors on the type's page (`/reference/Excel.Copilot#allowedUrls`).

- Only changes of **confirmed** groups count; group numbers come from `listGroups`. A type that never changed
  in a confirmed rollout has no page (404): the ~5,000 reflected paths are not pages.
- A rename is on the pages of both names (`apiChanges` is looked up by `path` and `from`).
- Legacy channels only (`prod`, `beta`): OneCDN serves the same host files, so its groups would repeat every
  change of a build on a second row. A build seen on OneCDN alone reaches `/reference` once it reaches legacy.
- A change whose files were all pulled back has status `abandoned`.
- `docs`: the type's status today from the `@types` catalogue (`ga` / `preview` / `undocumented`), its requirement
  set and Microsoft Learn URL ([`api-surface.md`](api-surface.md)); `/api/types` has the status per type too.
- The lookup is exact; on a miss a case-insensitive retry returns the canonical spelling and the page answers
  308 to it, so each type has one URL.

## Live updates (SSE)

`/api/live`: every 5 s the backend looks at the newest run in the database (this also works when the crawl
runs in a separate process). When a run starts or finishes, every client gets a snapshot — `homeSnapshot`,
the same object as `/api/home` (`event: update`); a new client gets one immediately on connect. Browsers
prefer the snapshot over the server render, so it must never be older: checks run one at a time (a slow
build started before a crawl wrote its data cannot finish last), a failed build is retried on the next poll,
and the snapshot is rebuilt every minute even without a new run (broadcast only when it changed). The
frontend also keeps its server render when a snapshot's `at` is older (`useLive`). A `: ping` comment every 25 s
keeps the connection alive; nginx does not buffer this route (`deploy/nginx-silentship.conf`). Next proxies
the stream without buffering (verified).
