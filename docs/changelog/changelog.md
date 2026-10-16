# Changelog — index

## Known issues

- 🟠 **The site partly returns errors for ~20–60 s during a deploy** — `npm run build` writes into the same
  `.next` folder the running Next process serves from (`deploy/deploy.sh`). Moving a finished `.next` from
  another folder does not work: Next 16 bakes the `distDir` name into its chunks. An option is release
  folders behind a symlink, with the unit's `WorkingDirectory` pointing at the symlink.
- 🔵 **No automated backups of `data/archive`.** The archive cannot be rebuilt after the fact
  (`../SETUP.md`, "Backups").
- 🔵 **Operator details on `/privacy` are a placeholder** (`frontend/lib/site.js`: `operator`).
- 🔵 **Sitemap status in Google Search Console** showed "Couldn't fetch" right after submitting
  (2026-10-15) although Googlebot fetched `/sitemap.xml` with a 200 — check again. Not yet submitted to Bing
  Webmaster Tools.

## History

- **2026-10-17** — [2026-10-17.md](2026-10-17.md)
  - `[Feature]` Umami events: `open_rollout`, `view_rollouts`, `subscribe_start`
  - `[Feature]` API type pages `/reference` with status, advice, error messages and history
  - `[Bug Fix]` Preview API changes saved before classification showed as High

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
