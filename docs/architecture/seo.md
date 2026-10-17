# SEO

Code: `frontend/lib/site.js` (`SITE`, `SITE_URL`, `pageMeta`), `frontend/app/layout.js`, `frontend/app/page.js`,
`frontend/app/rollouts/[channel]/[group]/page.js`, `frontend/app/sitemap.js`, `frontend/app/robots.js`,
`frontend/app/opengraph-image.js`, `frontend/app/llms.txt/route.js`; backend — `GET /api/sitemap`
(`sitemapGroups` in `backend/src/web/queries.js`).

## Absolute URLs

`SITE_URL` = `PUBLIC_URL` from the root `.env` (`https://silentship.dev` in production), falling back to
`https://silentship.dev`. It is the layout's `metadataBase`, so canonical URLs, `og:url` and `og:image`
become absolute. The variable is server-only: client components do not have it.

## Page metadata

Next merges metadata **shallowly**: a page that sets `alternates` or `openGraph` replaces the layout's whole
object — including the root's file-based `opengraph-image`, which would then reach only `/`. So
`pageMeta({ path, title, description, type })` builds them completely: canonical, RSS alternate, Open Graph
(`siteName`, `locale`, `url`, `type`, the shared image with size and alt), Twitter `summary_large_image` with
the same image.

| Page | title | canonical | Other |
|---|---|---|---|
| `/` | `silentship — know when Office.js changes on the CDN` (absolute) | `/` | JSON-LD `WebSite` |
| `/rollouts/<channel>/<group>` | `Office.js <build> rollout (production\|beta) — silentship` | `/rollouts/<channel>/<group>` | `og:type=article`; description with share, files, API changes; JSON-LD `TechArticle` (about `SoftwareApplication` Office.js with `softwareVersion` = the build; published = first seen, modified = completed/last seen) + `BreadcrumbList`; a missing rollout → `noindex` + 404 |
| `/reference` | `Office.js API changes by type — silentship` | `/reference` | hub, grouped by namespace; JSON-LD `CollectionPage` with an `ItemList` of every type page + `BreadcrumbList` |
| `/reference/<type>` | `<API> <what happened> in Office.js <channels> — silentship`, e.g. `Excel.SensitivityLabelAbacAttribute removed in Office.js beta`; several changed paths → `<type>: N API changes in Office.js` | `/reference/<type>` | `og:type=article`; the h1 repeats the title; JSON-LD `TechArticle` + `BreadcrumbList`; another spelling → 308; unknown → 404 + `noindex` |
| `/privacy` | `Privacy policy — silentship` | `/privacy` | — |
| any unknown URL | `Page not found — silentship` (`app/not-found.js`) | — | 404 + `noindex` (added by Next) |

**Structured data** is built by `frontend/lib/jsonLd.js` (`website`, `techArticle`, `breadcrumbs`,
`collectionPage`, `officeJs`) from the same title, description and dates as the page's metadata, and rendered
by `components/JsonLd.js`, which escapes `<` so no value can close the script tag. A new page type gets its
JSON-LD from these builders, not hand-written objects.

**Open Graph image** — `app/opengraph-image.js` (`next/og`, 1200×630, generated at build time), one for the whole site.

## `/sitemap.xml` — generated

`app/sitemap.js`, rendered per request (`force-dynamic`): at build time the backend may be down and the list
would be baked in empty; this way new rollouts appear without a redeploy. Contents:

- `/` — `lastmod` = the newest change of any rollout, `hourly`, priority 1;
- `/privacy` — `lastmod` = `SITE.updated`, `yearly`, 0.2;
- every rollout group from `/api/sitemap` — `lastmod` = max(`lastSeenAt`, `completedAt`), `daily`, priority
  0.8 for prod and 0.6 for beta;
- `/reference` — `lastmod` = the newest type, `daily`, 0.7;
- every API type page — `lastmod` = the newest change of its rollouts, `weekly`, 0.5.

The protocol limit is 50,000 URLs per file (`$limit` in `sitemapGroups`); far away. A down backend (e.g. mid-deploy)
gives an error (500), not a sitemap with only the static URLs: crawlers retry an error, while an empty 200
reads as "every rollout and type page is gone".

## `/robots.txt`

`app/robots.js`: everything is allowed except `/api/`, `/confirm`, `/unsubscribe`, `/health` (JSON, the SSE
stream, token links from emails and the uptime probe are not pages). The `Sitemap:` line is an absolute URL
from `SITE_URL`.

## `/llms.txt`

`app/llms.txt/route.js` — Markdown per [llmstxt.org](https://llmstxt.org): what silentship is, how to read
share and severity, the limits (only the CDN's JavaScript layer, no Microsoft code), links to the changelog,
RSS and sitemap, the 20 newest rollout groups from `/api/rollouts` and the 20 most recently changed API types from `/api/types`. Each rollout line has the
from-build, first-seen date, files, state, severity and API change count; each type line counts changes to the
type and its members. The severity text follows the table in [`api-surface.md`](api-surface.md). Rendered per
request, `text/plain; charset=utf-8`; a down backend gives 503 with `Retry-After`, never "no rollouts recorded". The JSON API is deliberately not listed: `/api/` is disallowed in `robots.txt`.

## After deploying (manual, outside the code)

- Add the site to Google Search Console and Bing Webmaster Tools and submit
  `https://silentship.dev/sitemap.xml`. "Couldn't fetch" right after submitting is normal and updates later;
  whether Googlebot really fetched the file shows in the nginx access log (`66.249.*`, `GET /sitemap.xml … 200`).
- Checks — [`../VERIFY.md`](../VERIFY.md), "SEO".

## API type pages (`/reference`)

Each page answers one exact search ("Excel.SensitivityLabelAbacAttribute removed"). Rules that keep them from
reading as thin or doorway pages:

- **Only changed types.** A page exists only for a type changed by a confirmed rollout (`/api/types`); the
  rest of the reflected surface (~5,000 paths) is 404 and outside the sitemap. A page per type, not per
  member: members are anchors, so one class with ten changed members is one page with ten rows.
- **Content from our own data:** state per channel (build, first seen, rollout progress), what it means for
  add-in code (per kind of change, preview/undocumented status, "beta only so far"), the change history with
  hosts and links to rollout pages, types changed by the same rollouts. No Microsoft code; documentation is a
  Microsoft Learn search link.
- **Honest titles:** the title names the channel ("in Office.js beta") and, for non-GA APIs, the status
  ("(preview API)", "(undocumented API)"), and follows the data: when a change reaches production or is
  pulled back, title and description change with it. When one build has several changes for the same API, a
  rename names the page, then a removal, then the rest: the old name is what people search for.
- **Status first:** next to the name, "Preview · ExcelApi BETA", "GA · ExcelApi 1.19" or "Undocumented", with a
  direct Microsoft Learn link or "Not in Microsoft's documentation". The advice depends on it: preview — do
  not use in production, check existence (no requirement set helps); GA removal — the set check still passes,
  check the API itself; undocumented — internal.
- **The error messages people search for:** after a removal or rename the page lists the TypeErrors add-in
  code gets — Chromium ("X is not a constructor", "Cannot read properties of undefined") and, when Mac or iOS
  files changed, Safari ("undefined is not a constructor").
- **One URL:** the exact identifier (`/reference/Excel.Range`), case kept; other spellings 308 to it.
- **Linked:** the nav ("API changes"), every API row on a rollout page, related types, the hub, `llms.txt`,
  the sitemap.
- **If Search Console reports many "Crawled – currently not indexed"** type pages, add a `noindex` threshold
  (e.g. beta-only additions with a single event) in `generateMetadata` of `app/reference/[type]/page.js`
  rather than dropping pages.
