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
object. So `pageMeta({ path, title, description, type })` builds them completely: canonical, RSS alternate,
Open Graph (`siteName`, `locale`, `url`, `type`), Twitter `summary_large_image`.

| Page | title | canonical | Other |
|---|---|---|---|
| `/` | `silentship — know when Office.js changes on the CDN` (absolute) | `/` | JSON-LD `WebSite` |
| `/rollouts/<channel>/<group>` | `Office.js <build> rollout (production\|beta) — silentship` | `/rollouts/<channel>/<group>` | `og:type=article`; description with share, files, API changes; a missing rollout → `noindex` + 404 |
| `/privacy` | `Privacy policy — silentship` | `/privacy` | — |

**Open Graph image** — `app/opengraph-image.js` (`next/og`, 1200×630, generated at build time), one for the whole site.

## `/sitemap.xml` — generated

`app/sitemap.js`, rendered per request (`force-dynamic`): at build time the backend may be down and the list
would be baked in empty; this way new rollouts appear without a redeploy. Contents:

- `/` — `lastmod` = the newest change of any rollout, `hourly`, priority 1;
- `/privacy` — `yearly`, 0.2;
- every rollout group from `/api/sitemap` — `lastmod` = max(`lastSeenAt`, `completedAt`), `daily`, priority
  0.8 for prod and 0.6 for beta.

The protocol limit is 50,000 URLs per file (`$limit` in `sitemapGroups`); far away. A down backend gives a
sitemap with the two static URLs instead of an error.

## `/robots.txt`

`app/robots.js`: everything is allowed except `/api/`, `/confirm`, `/unsubscribe`, `/health` (JSON, the SSE
stream, token links from emails and the uptime probe are not pages). The `Sitemap:` line is an absolute URL
from `SITE_URL`.

## `/llms.txt`

`app/llms.txt/route.js` — Markdown per [llmstxt.org](https://llmstxt.org): what silentship is, how to read
share and severity, the limits (only the CDN's JavaScript layer, no Microsoft code), links to the changelog,
RSS and sitemap, and the 20 newest rollout groups from `/api/rollouts`. Rendered per request,
`text/plain; charset=utf-8`. The JSON API is deliberately not listed: `/api/` is disallowed in `robots.txt`.

## After deploying (manual, outside the code)

- Add the site to Google Search Console and Bing Webmaster Tools and submit
  `https://silentship.dev/sitemap.xml`. "Couldn't fetch" right after submitting is normal and updates later;
  whether Googlebot really fetched the file shows in the nginx access log (`66.249.*`, `GET /sitemap.xml … 200`).
- Checks — [`../VERIFY.md`](../VERIFY.md), "SEO".

Per-method API pages (`TECH.md` §4) are not built yet — [`../tasks/PLAN.md`](../tasks/PLAN.md).
