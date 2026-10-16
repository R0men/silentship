# Analytics (Umami)

Code: `frontend/app/layout.js` (script), `frontend/lib/analytics.js` (`track`, `trackOnce`),
`frontend/components/Subscribe.js`, `Rollouts.js`, `Headline.js` (events), `frontend/app/privacy/page.js` (disclosure).

## The script

Umami Cloud, loaded with `next/script` (`strategy="afterInteractive"`):

- only when `NODE_ENV=production` (`npm run dev` does not load it);
- `data-domains="silentship.dev"` — Umami counts visits only on the production domain, so a local
  `npm start` or a test instance does not pollute the stats.

Umami sets no cookies and stores no IP addresses — no consent banner needed; `/privacy` says so ("What we
collect" and "Who processes it").

## Events

All events go through `track(name, data)` in `lib/analytics.js`. The script loads `afterInteractive`, so an
event can fire before `window.umami` exists: `track` retries every 500 ms for up to 10 s, then drops it. A
blocked script or dev mode never breaks the page. `trackOnce` sends an event once per visit (a
`sessionStorage` flag; without storage — once per page).

| Event | When | Data |
|---|---|---|
| `view_rollouts` | the "Rollouts" section enters the viewport (`IntersectionObserver`), once per visit | — |
| `open_rollout` | click on a rollout row (`Rollouts.js`) or the headline link (`Headline.js`) | `channel`, `severity`, `from`: `list` \| `headline` |
| `subscribe_start` | first focus in the email field, once per visit | — |
| `subscribe` | **after** `POST /api/subscribe` succeeded, so failed attempts (400/429) are not counted | `beta` |

Funnel in the Umami dashboard (Funnels report): visit → `view_rollouts` → `open_rollout`, and
`subscribe_start` → `subscribe`. "Started but did not subscribe" is `subscribe_start` minus `subscribe`; it is
not sent as its own event, because leaving the page cannot be reported reliably.

## Ad blockers

Some developers block `cloud.umami.is`. If the numbers look suspiciously low, proxy the script through the
own domain via rewrites in `next.config.mjs` and set `data-host-url`. `/api/send` is taken by the backend
proxy (`/api/*`), so use another path, e.g. `/stats/script.js` with
`data-host-url="https://silentship.dev/stats"` (the script posts to `<host-url>/api/send` →
`/stats/api/send`). Not done yet — [`../tasks/PLAN.md`](../tasks/PLAN.md).

## Checking

After a deploy, open the site and check that the visit appears in the Umami dashboard (data arrives almost
immediately). Details — [`../VERIFY.md`](../VERIFY.md).
