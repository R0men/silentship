# SEO

Code: `frontend/lib/site.js` (`SITE`, `SITE_URL`, `pageMeta`), `frontend/app/layout.js`, `frontend/app/page.js`,
`frontend/app/rollouts/[channel]/[group]/page.js`, `frontend/app/sitemap.js`, `frontend/app/robots.js`,
`frontend/app/opengraph-image.js`, `frontend/app/llms.txt/route.js`; backend — `GET /api/sitemap`
(`sitemapReleases` in `backend/src/web/queries.js`: one URL per track and build, never a OneCDN one —
those 301 to the track's page).

## Absolute URLs

`SITE_URL` = `PUBLIC_URL` from the root `.env` (`https://silentship.dev` in production), falling back to
`https://silentship.dev`. It is the layout's `metadataBase`, so canonical URLs, `og:url` and `og:image`
become absolute. The variable is server-only: client components do not have it.

## Page metadata

Next merges metadata **shallowly**: a page that sets `alternates` or `openGraph` replaces the layout's whole
object — including the root's file-based `opengraph-image`, which would then reach only `/`. So
`pageMeta({ path, title, description, type })` builds them completely: canonical, RSS alternate, Open Graph
(`siteName`, `locale`, `url`, `type`, the page's image with size and alt), Twitter `summary_large_image` with
the same image.

**Lengths.** A title longer than 65 characters with the ` — silentship` suffix is set `absolute` by `pageMeta`:
the suffix goes, not the page's own words. Descriptions stay within 160 characters (search results cut the rest):
generated ones (`metaDescription` in `lib/apiType.js`, `describe` on rollout pages and `/reference`) drop optional
sentences to fit; note descriptions are checked by hand.

| Page | title | canonical | Other |
|---|---|---|---|
| `/` | `Office.js changelog: live CDN builds and API changes — silentship` (absolute) | `/` | the h1 starts with the line "Office.js changelog · <state>" (the eyebrow, inside the h1), so the phrase stays whatever the headline says about the current build; JSON-LD `WebSite` |
| `/rollouts/<channel>/<group>` | `Office.js <short build> (production\|beta): <N> API changes — silentship`, e.g. `Office.js 16.0.20710 (production): 15 API changes` | `/rollouts/<channel>/<group>`; for a beta release with the same API changes as production — the production page (below) | h1 `Office.js <build>`; `og:type=article`; own preview (build, API changes, severity, state); description "Office.js <build> on the <channel> CDN: 15 API changes in 21 of 22 host files, medium severity; rollout complete. First seen …"; JSON-LD `TechArticle` (about a `Thing` "Office.js <build>" — not `SoftwareApplication`, which Google rejects without offers or ratings; published = first seen, modified = completed/last seen) + `BreadcrumbList`; a missing rollout → `noindex` + 404 |
| `/reference` | `Office.js API changelog: changes in each CDN build — silentship` | `/reference` | h1 `Office.js API changelog`; the description leads with the newest Medium or High change (`latestNotableChange`, `latestChangeText`: "Latest: Word.LineFormat lost 8 WordApiDesktop 1.3 properties in 16.0.20619 (Oct 2026)."; a single change is named by its path: "Latest: Office.ribbon.requestUpdate (RibbonApi 1.1) implementation changed in 16.0.20710 (Nov 2026).") and updates itself; the general sentence after it shortens to stay within 160 characters; hub, grouped by namespace; JSON-LD `CollectionPage` with an `ItemList` of every type page + `BreadcrumbList` |
| `/reference/<type>` | `<API> <what happened> in Office.js[ beta][ (preview\|undocumented)] — silentship`, e.g. `Excel.SensitivityLabelAbacAttribute removed in Office.js beta (preview)`: production is implied, beta-only is said; several changed paths → `<type>: N API changes in Office.js` | `/reference/<type>` | `og:type=article`; own preview (the type and what happened); description "<type> (<status>): <change> in Office.js <build>[ beta], first seen <day>." plus the hosts, "Not in production yet." and "Full change history." as far as 160 characters allow; an **undocumented** type is `noindex, follow` and out of the sitemap (`indexedType`); the h1 repeats the title; JSON-LD `TechArticle` + `BreadcrumbList`; another spelling → 308; unknown → 404 + `noindex` |
| `/notes` | `Notes — silentship` | `/notes` | list of notes, newest first; JSON-LD `CollectionPage` + `BreadcrumbList` |
| `/notes/<slug>` | `<seoTitle or title> — silentship`, e.g. `New Office.js CDN endpoint vs. appsforoffice: what changes` | `/notes/<slug>` | `og:type=article` with `article:published_time`, `modified_time` (`updated`) and `article:tag` (`keywords`); its own preview image (`app/notes/[slug]/opengraph-image.js`, the title on the shared design); the h1 is `title`; JSON-LD `TechArticle` with `keywords` and `image` + `BreadcrumbList` |
| `/privacy` | `Privacy policy — silentship` | `/privacy` | `noindex, follow` in the robots meta and an `X-Robots-Tag` header (`next.config.mjs`); not in the sitemap (left crawlable in `robots.txt` so the `noindex` is seen); the footer links it `rel="nofollow"` |
| any unknown URL | `Page not found — silentship` (`app/not-found.js`) | — | 404 + `noindex` (added by Next) |

**Structured data** is built by `frontend/lib/jsonLd.js` (`website`, `techArticle`, `breadcrumbs`,
`collectionPage`, `officeJs`) from the same title, description and dates as the page's metadata, and rendered
by `components/JsonLd.js`, which escapes `<` so no value can close the script tag. A new page type gets its
JSON-LD from these builders, not hand-written objects.

**Open Graph images** share one design, `lib/ogCard.js` (`next/og`, 1200×630): `app/opengraph-image.js` for pages
without their own (built once), notes (built at build time), rollout and API type pages (rendered per request from
the API; 404 for an unknown one). A page points at its own with `ownImage(path, alt)` from `lib/site.js`. Long API
paths wrap after a dot. `TechArticle` always carries an `image` (the page's, else the shared one); the publisher
`Organization` has `logo` = `/icon.svg`.

## `/sitemap.xml` — generated

`app/sitemap.js`, rendered per request (`force-dynamic`): at build time the backend may be down and the list
would be baked in empty; this way new rollouts appear without a redeploy. Contents:

- `/` — `lastmod` = the newest change of any rollout, `hourly`, priority 1;
- every rollout group from `/api/sitemap` — `lastmod` = max(`lastSeenAt`, `completedAt`), `daily`, priority
  0.8 for prod and 0.6 for beta; a beta release whose canonical page is production's is left out (`sitemapReleases`);
- `/notes` — `lastmod` = the newest `updated` or `date` of any note, `weekly`, 0.6; every note — its `updated` or else `date`,
  `monthly`, 0.7 (read from `content/notes/`, no backend; `lib/notes.js` rejects a date that is not a real
  `YYYY-MM-DD`, so a typo fails the build instead of the sitemap);
- `/reference` — `lastmod` = the newest type, `daily`, 0.7;
- every indexed API type page (`indexedType`; `/api/sitemap` sends each type's `docs` status) — `lastmod` = the
  newest change of its rollouts, `weekly`, 0.5.

The protocol limit is 50,000 URLs per file (`$limit` in `sitemapGroups`); far away. A down backend (e.g. mid-deploy)
gives an error (500), not a sitemap with only the static URLs: crawlers retry an error, while an empty 200
reads as "every rollout and type page is gone".

## Production and beta pages of one build

Beta usually gets a build first and production the very same build later. When both releases carry exactly the
same API changes (`path`, `from`, `kind`), the two pages say the same thing: `getRelease("beta", …)` returns
`canonicalTrack: "prod"`, the beta page's canonical, `og:url` and JSON-LD point at the production page, it shows
"Production got this build with the same API changes →", and the sitemap lists only the production page. When
the changes differ (beta often has more), both pages stay canonical. RSS keeps both items.

## Headers

`Strict-Transport-Security: max-age=31536000` on every response (`next.config.mjs`), without `includeSubDomains` or
`preload`: both are hard to take back.

## `/robots.txt`

`app/robots.js`: everything is allowed except `/api/`, `/confirm`, `/unsubscribe`, `/health` (JSON, the SSE
stream, token links from emails and the uptime probe are not pages). The `Sitemap:` line is an absolute URL
from `SITE_URL`.

## `/llms.txt`

`app/llms.txt/route.js` — Markdown per [llmstxt.org](https://llmstxt.org): what silentship is, how to read
share and severity, the limits (only the CDN's JavaScript layer, no Microsoft code), links to the changelog,
RSS and sitemap, every note (title, date, description), the 20 newest rollout groups from `/api/rollouts` and the 20 most recently changed API types from `/api/types`. Each rollout line leads with
the unique API changes and the files carrying them, then the from-build, first-seen date, files, state and severity; each type line counts changes to the
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
- **Undocumented types are `noindex`** (`indexedType` in `lib/apiType.js`): internals of Office.js that few people
  search for would otherwise make most of the index. The pages stay, linked from the hub and `llms.txt`. A
  documented type that changed only in undocumented members (`Excel.PivotTable`) stays indexed. If Search Console
  still reports many "Crawled – currently not indexed" type pages, raise the threshold there rather than drop pages.

## Internal links to notes

- The nav and the footer link `/notes` on every page.
- Every note ends with "More from silentship": up to three other notes, the live rollouts, `/reference`, RSS.
- Notes have their own feed, `/notes/rss.xml` (one item per note, `pubDate` = its date); `/notes` and note
  pages announce it next to the rollouts feed (`NOTES_RSS` → `pageMeta({ rss })`). `/rss.xml` stays rollouts only.
- A rollout page links a note as "Write-up →" when the note's `builds` lists the build.
- Rollout pages link the endpoints note (`ENDPOINTS_NOTE` in `lib/site.js`) under the endpoint comparison
  ("What differs between the endpoints") and in the `loader-flags-changed` notice. Renaming that note's file
  means updating `ENDPOINTS_NOTE`.
- Links inside a note's Markdown are relative (`/rollouts/…`, `/#rollouts`), so they stay on the canonical host.
