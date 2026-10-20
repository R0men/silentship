# Changelog — index

## Known issues

- 🟠 **The site partly returns errors for ~20–60 s during a deploy** — `npm run build` writes into the same
  `.next` folder the running Next process serves from (`deploy/deploy.sh`). Moving a finished `.next` from
  another folder does not work: Next 16 bakes the `distDir` name into its chunks. An option is release
  folders behind a symlink, with the unit's `WorkingDirectory` pointing at the symlink.
- 🔵 **No automated backups of `data/archive`.** The archive cannot be rebuilt after the fact
  (`../SETUP.md`, "Backups").
- 🔵 **OneCDN edge spread:** compare how many distinct edges each endpoint reaches from the server, by the
  `a=` field of `Akamai-Request-BC` (`architecture/cdn-facts.md`); from one home network both landed on the
  same edge.
- 🔵 **Operator details on `/privacy` are a placeholder** (`frontend/lib/site.js`: `operator`).
- 🔵 **Sitemap status in Google Search Console** showed "Couldn't fetch" right after submitting
  (2026-10-15) although Googlebot fetched `/sitemap.xml` with a 200 — check again. Not yet submitted to Bing
  Webmaster Tools.

## History

- **2026-10-20** — [2026-10-20.md](2026-10-20.md)
  - `[Feature]` Notes: `/notes`, the first note on what the new Office.js CDN endpoint changes
  - `[Feature]` Rollout pages link the endpoints note

- **2026-10-19** — [2026-10-19.md](2026-10-19.md)
  - `[Feature]` OneCDN endpoint (`officeapis.public.onecdn.static.microsoft`): channels `onecdn-prod`, `onecdn-beta`; a new channel's first run is a baseline
  - `[Feature]` Loader security-default flags; `loader-flags-changed` is High
  - `[Feature]` One alert per build across both endpoints (email and Slack)
  - `[Feature]` One UI for both endpoints: two tracks, one page per build, divergence shown only when it exists
  - `[Style]` Neutral live badge in server HTML, footer links, both endpoints in the description
  - `[Feature]` Channel card shows the latest release when nothing rolls out
  - `[Style]` Ko-fi support link in the site footer and in emails
  - `[Bug Fix]` "Rollouts" in the nav did nothing on a second click

- **2026-10-17** — [2026-10-17.md](2026-10-17.md)
  - `[Feature]` Umami events: `open_rollout`, `view_rollouts`, `subscribe_start`
  - `[Feature]` API type pages `/reference` with status, advice, error messages and history
  - `[Bug Fix]` Preview API changes saved before classification showed as High
  - `[Bug Fix]` Overlapping crawls created duplicate rollouts: crawl lock in MongoDB, unique rolling index
  - `[Style]` Rollout list columns no longer shift with the counts
  - `[Bug Fix]` SEO: preview image on every page, honest llms.txt and sitemap
  - `[Feature]` Structured data (JSON-LD) on every page

- **2026-10-15** — [2026-10-15.md](2026-10-15.md)
  - `[Infra]` Repository, CI and automatic deploys to the VPS
  - `[Feature]` SEO: generated sitemap.xml, robots.txt, canonical URLs, Open Graph
  - `[Feature]` llms.txt
  - `[Feature]` Umami analytics and the `subscribe` event
  - `[Feature]` Emails go out from `silentship <alerts@silentship.dev>`; subscriptions are open
  - `[Style]` HTML emails in the site's style; `mail-preview` command
  - `[Style]` One product name — silentship; launch banner removed
  - `[Docs]` Documentation restructured and translated to English
  - `[Bug Fix]` Rollout alerts need confirmation and API changes; rollbacks always alert
  - `[Bug Fix]` The site shows only confirmed rollouts; counters count builds
  - `[Bug Fix]` Removals are grouped per file
  - `[Bug Fix]` Email links no longer change a subscription on GET
  - `[Bug Fix]` Alerts are queued and retried; one alert per build, then updates
  - `[Bug Fix]` Subscribing an address that is already subscribed
  - `[Bug Fix]` Size limit on CDN responses
  - `[Bug Fix]` Per-address limits on subscribe emails
