# Frontend (Next.js)

Code: `frontend/` — Next.js 16 (App Router, Turbopack), React 19, JavaScript. Port 3000.

> Next 16 has breaking changes compared with older versions. Before editing, read the docs bundled in
> `node_modules/next/dist/docs/` (see `frontend/AGENTS.md`).

## Pages

| Route | File | Rendering |
|---|---|---|
| `/` | `app/page.js` — headline with live numbers, subscribe form, channel status, rollout feed; all from one `/api/home` snapshot, then `/api/live` | SSR on every request (`force-dynamic`) |
| `/rollouts/[channel]/[group]` | `app/rollouts/[channel]/[group]/page.js` — one release of a track (`prod`, `beta`): a progress bar per endpoint (legacy, onecdn) with share and completion time, facts, one file table, "Host files byte-identical on both endpoints" or the files of this build that differ, files "not yet on" an endpoint still on an older build, the `loader-flags-changed` notice only when the flags changed. `/rollouts/onecdn-prod/*` and `/rollouts/onecdn-beta/*` → 301 to the track's page (`redirects` in `next.config.mjs`) | SSR on every request |
| `/reference` | `app/reference/page.js` — hub: every API type changed by a confirmed rollout, by namespace | SSR on every request |
| `/reference/[type]` | `app/reference/[type]/page.js` — one API type: state per channel, advice, change history, related types; wording in `lib/apiType.js` ([`seo.md`](seo.md)) | SSR on every request |
| `/notes` | `app/notes/page.js` — every note, newest first | static at build time |
| `/notes/[slug]` | `app/notes/[slug]/page.js` — one note: Markdown from `content/notes/<slug>.md` rendered by `lib/notes.js` | static at build time (`generateStaticParams`, unknown slug → 404) |
| `/privacy` | `app/privacy/page.js`; operator details in `lib/site.js` | static at build time |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/opengraph-image` | [`seo.md`](seo.md) | — |

**One UI for both endpoints.** The crawler has four channels, but the site shows two tracks — production and
beta (`CHANNELS` in `lib/format.js`) — because the legacy and OneCDN endpoints serve byte-identical host files
(`ENDPOINTS`: `appsforoffice.microsoft.com`, `officeapis.public.onecdn.static.microsoft`). The home page has two
cards; under the build, "Same build on legacy and onecdn" or each endpoint's build, then a share bar per
release in flight — or, when nothing rolls, the newest release with how it ended ("Complete 16.0.20606.15070",
completion time, a full bar). The list has one row per
track and build; a row carries an endpoint badge (`divergence`: "N files differ", "loader flags changed") only
when the endpoints diverge on the same build, and a neutral "not yet on onecdn" (`notYetOn`) while one endpoint
still serves files on an older build. API counts everywhere are unique changes first, files second
(`apiChangesText`: "5 API changes in 19 files"). There is no endpoint filter. A card with a release in flight
shows its share per endpoint ("legacy 1% · onecdn 3% of edges") and under it "previous: 16.0.20612
complete" (`overview.previous`).

**A release page explains itself** (`releaseSummary` in `lib/format.js`): one sentence on what rolls out
where, since when and on what share, and a verdict by severity — no public API changes / only preview or
undocumented APIs / no breaking changes to documented APIs / "Documented API changed: N changes", for High
with up to three biggest groups ("Word.LineFormat: 8 members removed"). Then "Get email alerts →" (the home
form, `/#subscribe`) and "Write-up →" for a note whose front matter lists the build in `builds`. Dates in the
facts are relative with the absolute UTC time next to them (`When` in `components/ui.js`). Files one
endpoint has not served yet read from the new version's side: "New version seen on legacy only (8): …",
with a hint that shares are averages over all sampled responses.

## Notes

Write-ups (e.g. a rollout we watched end to end) live in the repository as `frontend/content/notes/<slug>.md`:
front matter with `title` (the h1), `description` (meta, ≤160 chars), `date` (`YYYY-MM-DD`) and optionally
`seoTitle` (the `<title>`), `updated` (`YYYY-MM-DD`; both dates are validated), `keywords` (comma-separated), `builds`
(comma-separated Office.js builds whose rollout pages link the note as "Write-up →") and `checked` (when the facts were last
verified, shown next to the date) — SEO use in [`seo.md`](seo.md), then Markdown (GFM: tables, code blocks), rendered with `marked` at
build time (`lib/notes.js`). A line `<!-- subscribe: lead text -->` puts the site's subscribe form there. The HTML is trusted because it is our own text. Images go
to `frontend/public/notes/` and are linked as `/notes/<file>`; links to the site are relative. A new note
needs a deploy; the hub, sitemap, `llms.txt` and the notes feed `/notes/rss.xml` (`app/notes/rss.xml/route.js`,
linked from `/notes` and announced as an RSS alternate on note pages) pick it up on their own. Styles: `.prose.post` and
`.post-list` in `globals.css`.

## Talking to the backend

- Server components call the backend directly (`lib/api.js`, `API_URL`, default
  `http://127.0.0.1:$API_PORT`). With `apiGetOr`, a down backend renders an empty page instead of an error.
- Browsers only talk to the frontend's origin; `/api/*`, `/rss.xml`, `/confirm`, `/unsubscribe` and `/health`
  are proxied by rewrites in `next.config.mjs`. No CORS needed.
- `next.config.mjs` loads the root `.env` (`process.loadEnvFile`) — the same one as the backend. `API_URL`
  is resolved when the server starts, not at build time, so one build works with any backend.
- `NEXT_DIST_DIR` — a different build folder (a second instance next to the running one).

## Live updates

One `EventSource` per tab (`components/Live.js`, `LiveProvider`): the headline, channel status and feed
update in place; a rollout page calls `router.refresh()` (`LiveRefresh`).

**Nav "Rollouts"** is `SectionLink`: a plain `#rollouts` anchor on the home page, so every click scrolls there
(next/link does nothing when the URL, hash included, is already the target), and a `/#rollouts` link elsewhere.

**The nav badge** (`LiveBadge`) has three states: `connecting` — a dot without a label, which is what the
server-rendered HTML shows (bots and link previews must not read "Offline"); `live` once the stream answers;
`offline` only after a real stream error (EventSource keeps reconnecting).

**Headline with live numbers** (`components/Headline.js`): "Office.js 16.0.20619 is rolling out: 1% of sampled
edges, high-severity API changes." (`severityPhrase`) — production first, else "… is rolling out on beta: …",
and a quiet-time variant. Any release the RSS feed or an alert has (confirmed, rolling on either endpoint)
leads here: the headline, cards, list and the "N with high-severity changes" counter all read one snapshot,
and a live snapshot older than the server render never replaces it (also in the list's counter). The
wording is deliberately about the CDN's share, not users': we measure edge responses, and a user gets the
new version when Office next loads the add-in from such an edge.

## Design

Dark and flat — no component backgrounds or boxes; hierarchy comes from type (Inter, JetBrains Mono),
spacing and thin dividers. The hero has a pseudo-3D torus knot of white dots on a 2D canvas (`Scene.js`,
perspective projection, no WebGL or dependencies) that stops when off-screen and under
`prefers-reduced-motion`. The product name in the UI is **silentship** (`silentship.dev` only as an address).

The footer (`app/layout.js`, every page) names both endpoints, the scope limit, and links, all in one style
(the faint footer colour, underlined on hover), to Notes, the GitHub repository (`SITE.repo`), Contact
(`mailto:` `SITE.contactEmail`), Ko-fi (`SITE.support`) and Privacy (`rel="nofollow"`: the page is `noindex`). On a rollout page the
visible labels of its sections are a tab and table column headers, which cannot hold a heading; visually
hidden `<h2>` (`.sr-only`) give the page its outline ("Edges on new version", "API changes (N)" / "Files (N)")
for screen readers and crawlers without changing the look.
