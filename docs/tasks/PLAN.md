# Plan — agreed, not built yet

An index of work agreed in `TECH.md` but not done. Unlike [`../changelog/changelog.md`](../changelog/changelog.md)
("Known issues" — problems in what already works), these are changes that are not in the code yet. Phases —
`../../TECH.md` §4.

| # | Task | Phase | Status | Priority |
|---|---|---|---|---|
| 1 | Watchlist and `minSeverity` UI for subscribers (today only the `npm run watch` CLI) | 1 | not started | 🔴 |
| 2 | A page per public API method with its change history, included in the sitemap | 1 | not started | 🟠 |
| 3 | Weekly digest "What changed in Office.js this week" (email + RSS) | 1 | not started | 🟡 |
| 4 | Customer CI trigger: `repository_dispatch` / generic webhook + a GitHub Action template | 1.5 | not started | 🟠 |
| 5 | Multi-region: crawl from 2–3 locations (EU/US/Asia), compare regions | 1.5 | not started | 🟡 |
| 6 | Playwright bisection (`page.route`, old version from the archive vs. new) | 2 | on demand | 🔵 |
| 7 | Correlation with `OfficeDev/office-js` issues | 2 | on demand | 🔵 |
| 8 | Discord / Teams / Telegram | — | not started | 🟡 |
| 9 | Proxy Umami through the own domain (`/stats/*`) if ad blockers cut the stats | — | only if numbers look low | 🟡 |

Order: **1 → 2 → 4**, the rest as signals come in.

## 1. Watchlist UI

The model exists: `subscribers.watchItems[] = { pattern, hosts }`, `minSeverity`; matching —
`backend/src/analysis/watchlist.js`. Missing: a settings page reached by the token from emails (like
`/unsubscribe`) and write endpoints that validate patterns.

## 2. Per-method pages

The data is in `apiChanges` (index `{path}`). Needed: a route that is **not** under `/api/` (that prefix is
proxied to the backend) — e.g. `/reference/excel/range/applyfilter`; a read model "change history of a
path"; canonical URLs; a `<title>` with the method and host; entries in `app/sitemap.js`
(`docs/architecture/seo.md`).
