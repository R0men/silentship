# Plan — agreed, not built yet

An index of work agreed in `TECH.md` but not done. Unlike [`../changelog/changelog.md`](../changelog/changelog.md)
("Known issues" — problems in what already works), these are changes that are not in the code yet. Phases —
`../../TECH.md` §4.

| # | Task | Phase | Status | Priority |
|---|---|---|---|---|
| 1 | Watchlist and `minSeverity` UI for subscribers (today only the `npm run watch` CLI) | 1 | not started | 🔴 |
| 3 | Weekly digest "What changed in Office.js this week" (email + RSS) | 1 | not started | 🟡 |
| 4 | Customer CI trigger: `repository_dispatch` / generic webhook + a GitHub Action template | 1.5 | not started | 🟠 |
| 5 | Multi-region: crawl from 2–3 locations (EU/US/Asia), compare regions | 1.5 | not started | 🟡 |
| 6 | Playwright bisection (`page.route`, old version from the archive vs. new) | 2 | on demand | 🔵 |
| 7 | Correlation with `OfficeDev/office-js` issues | 2 | on demand | 🔵 |
| 8 | Discord / Teams / Telegram | — | not started | 🟡 |
| 9 | Proxy Umami through the own domain (`/stats/*`) if ad blockers cut the stats | — | only if numbers look low | 🟡 |
| 10 | CDN incidents: show short outages (e.g. a file 404 on most edges for one run) as their own events | 1 | not started | 🟠 nobody else records these |

Order: **1 → 4**, the rest as signals come in.

## 1. Watchlist UI

The model exists: `subscribers.watchItems[] = { pattern, hosts }`, `minSeverity`; matching —
`backend/src/analysis/watchlist.js`. Missing: a settings page reached by the token from emails (like
`/unsubscribe`) and write endpoints that validate patterns.

## 10. CDN incidents

For an add-in developer a run where most edges answer 404 for a host file is a real outage, however short:
on 2026-10-15 at 16:16 UTC five of eight edges returned 404 for `onenote-winrt-16.00.js` (OneNote on
Windows), and the next run served it again. Its per-run samples expire around 2027-01-13 (TTL). Today such a sighting is a rollout that is never confirmed and
is abandoned after 24 h without an alert and is hidden on the site (`docs/architecture/alerts.md`). Plan:

- Detect it from data we already have: a removal (or a new sha) seen in exactly one run, or 404 / 5xx on
  ≥ 50% of a file's samples while the stable version keeps being served.
- Show it on the site as its own event, e.g. "CDN incident: onenote-winrt-16.00.js 404 on 5/8 edges,
  16:16 UTC, ~10 min", with edge IPs and locations from `snapshots`; list it in RSS and `llms.txt`.
- Keep it: `snapshots` expire after 90 days (TTL), so an incident record must copy its evidence (sample
  counts, edges, timestamps) into a permanent collection when detected. Do not delete the abandoned rollout
  documents of past incidents.
- Alert on it only once it is clearly an outage (several runs or several files); a single-run event is
  site-only.
