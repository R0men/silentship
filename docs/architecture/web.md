# Backend web API

Code: `backend/src/web/server.js` (Fastify, routes), `queries.js` (read models), `live.js` (SSE),
`public-api.js` (the public `/api/v1`). Listens on
`API_HOST:API_PORT` (`127.0.0.1:4000`); reachable from outside only through the frontend's proxy.

## Routes

| Route | What | Proxied by Next |
|---|---|---|
| `GET /health` | 200/503 for uptime monitors: every channel finished a run within `HEALTH_STALE_MINUTES` (20), the last run did not fail, none has been running for more than twice that (40 min) | `/health` |
| `GET /api/overview` | Per track (`prod`, `beta`): stable build, last run, `endpoints` (legacy and OneCDN: build, last run), active releases, `latest` (the newest release, shown when nothing rolls), `previous` (the newest release not in flight, shown under a rolling one); 30-day stats (distinct builds, and builds or other changes with High severity — not groups) | `/api/*` |
| `GET /api/home` | The home page in one call (`homeSnapshot`): `{ overview, rollouts, at }` — `/api/overview` plus the 30 newest releases; the same object `/api/live` pushes | `/api/*` |
| `GET /api/rollouts?channel&severity&before&limit` | Releases (`listReleases`), newest first; `channel` is the track; `before` is a `firstSeenAt` cursor; `limit` 1–100 (30) | `/api/*` |
| `GET /api/rollouts/:track/:group` | One release (`getRelease`): both `endpoints`, hosts, share history and API changes of the primary group (the same `Office.*` change from several files is one row with the file list), `differentFiles`, `notYetOn`, `flags` (the `loader-flags-changed` notice per endpoint, empty unless the flags changed), `loader`: `identical`, `flags-only` (same `bodyHashSansFlags`), `different`; `canonicalTrack`: `"prod"` for a beta release with exactly the same API changes as production's release of the build, else null ([`seo.md`](seo.md)). 404 for a OneCDN channel | `/api/*` |
| `GET /api/types` | Every API type changed by a confirmed rollout (`listApiTypes`): channels, kinds, highest severity, dates, `app` (the Office application, `analysis/apps.js`) | `/api/*` |
| `GET /api/types/:type` | One type's change history (`getApiType`): one event per group, path and kind with files and pulled-back files, related types; `type` in the reply is the canonical spelling | `/api/*` |
| `GET /api/sitemap` | Keys and dates of every rollout page (without beta releases whose canonical page is production's) and every API type page with its `docs` status, for `/sitemap.xml` ([`seo.md`](seo.md)) | `/api/*` |
| `GET /api/live` | Server-Sent Events, see below | `/api/*` |
| `GET /rss.xml` | RSS 2.0, the 50 newest releases (one item per track and build) | `/rss.xml` |
| `POST /api/subscribe`, `GET\|POST /confirm`, `GET\|POST /unsubscribe` | Subscriptions; GET only shows a page with a button, POST changes state ([`alerts.md`](alerts.md)) | yes |
| `POST /api/signin`, `POST /api/signin/verify` | Passwordless sign-in to `/settings`: an emailed 6-digit code in exchange for the subscriber's token ([`alerts.md`](alerts.md)) | yes |
| `GET /api/v1/…` | The public read-only API, see "Public API (v1)" below and `/developers` | `/api/*` |
| `GET\|POST /api/settings?token=…` | A subscriber's channels, `minSeverity`, applications and watchlist, for `/settings` ([`alerts.md`](alerts.md)) | yes |

## Public API (v1)

`/api/v1` (`public-api.js`, a Fastify plugin with its own hooks) is the documented API at `/developers`:
`/releases?track&severity&before&limit` (`{ releases, next }`), `/releases/:track/:build` (with `hostFiles` and
`changes`), `/types`, `/types/:type`. The internal routes above serve the site and may change with it; v1 does not.

- **Own shapes.** `v1Release`, `v1ReleaseDetail`, `v1Change`, `v1Type`, `v1TypeDetail` copy named fields
  only, so nothing internal (`region`, share history, `lowered`, …) leaks and a read-model change does not
  change the API. Public names: `track`, `build`, status `pulledBack` for `abandoned`, `documentation` for
  `apiStatus`, `app` from `analysis/apps.js`.
- **Compatibility rule:** v1 only gains fields; renaming, removing or changing the meaning of one is `/api/v2`,
  with v1 kept running. New enum values (`kind`, `status`, `app`) may appear and are documented as such.
  `test/public-api.test.js` pins the release field list.
- **CORS** `Access-Control-Allow-Origin: *` on this prefix only, never with credentials: nothing here reads a
  cookie or token or returns personal data. `/api/settings`, `/api/signin` and the rest send no CORS headers
  (a test checks `/api/settings`). Also `X-Content-Type-Options: nosniff`, `Content-Security-Policy:
  default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: cross-origin`,
  `Referrer-Policy: no-referrer`; `Cache-Control: public, max-age=60` on 2xx and 404, `no-store` on errors.
  `OPTIONS` answers a preflight (204, GET/HEAD/OPTIONS, max-age a day) without counting it.
- **Rate limits before any work:** `V1_LIMIT_PER_MINUTE` (60) per client — an IPv4 address or an IPv6 /64
  (`clientKey`), from `req.ip`, which trusts loopback proxies only, so it is nginx's `X-Forwarded-For` —
  and `V1_OVERALL_PER_MINUTE` (1 200) for everyone, so the database load is bounded whatever the number of
  clients. Fixed one-minute windows (`windowLimiter`); when its table (50 000 clients) is full, expired
  entries are swept and a new client is refused rather than a limited one forgotten. `RateLimit-*` headers
  on every answer, `429` with `Retry-After`.
- **Validation:** every parameter against a list or a pattern (`limit` 1–100 digits only, `before` a date
  of at most 40 characters, a repeated parameter is invalid); unknown parameters are ignored. Errors are fixed
  codes (`invalid_*`, `not_found`, `rate_limited`, `busy`, `internal`); details go to the log only.
- **Cost:** a run cache of its own (200 entries), so API traffic cannot push the site's pages out; paging
  with `before` is not cached (every cursor would be a new key); `/types/:type` answers 404 for a type no
  build changed from the cached type list, without a database query.

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
a baseline, so the build never was a rollout there — the `build` of its `bootstrap` run, or a file still
stable on it in `fileStates`; fileStates alone forget the baseline once the next build completes there), or
`null` (not seen). A baseline side is never "not yet on" that endpoint.
- Numbers (files, share, API changes, severity, completion) are the legacy group's; the OneCDN one's when
  legacy has not shown the build. `firstSeenAt` is the earliest of both groups and `lastSeenAt` the latest, so
  the page, its meta, the list and the paging cursor date a release from whichever endpoint served it first. Filters (`severity`, `before`) apply to that primary group, so paging sees a
  release once; `activeOnly` keeps a release rolling on either endpoint.
- Files are compared only where **both endpoints serve this build** — the group's rollout there, or a stable
  version stamped with it. A file one endpoint still serves on an older build is not a difference but
  `notYetOn: { legacy, onecdn }` (a build seen on one endpoint only has all its files there). `differentFiles`
  are files of this build with other bytes on the two endpoints; `office.js` is left out, it always differs
  by the flags.
- `diverged` is true when `differentFiles` is not empty or the loader flags changed (`flagsChanged`).
- `onecdnCrawled` is false when `CHANNELS` has no OneCDN twin; then a release is just the legacy group.
- Group numbers still come only from `listGroups`; releases combine its results.

## Caching

Read models change only when a crawl writes, and a page costs dozens of round trips to the database (about 35 ms
each from production), which is where almost all of a response's time goes. So `/api/home` and `/api/overview` are
served from the live feed's snapshot, and the other read routes from `createRunCache` (`web/run-cache.js`): a result
is reused until `live.version` changes, within seconds of a crawl starting or finishing and at least every 5 minutes.
Concurrent requests share one build, a failed build is not kept, and at most 100 results are held. `/health` is
never cached.

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
- `/api/types` also returns `latest` (`latestNotableChange`): from the newest release that was not pulled back
  and has a Medium or High API change, the largest set of same-kind changes on one type at the top severity.
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
