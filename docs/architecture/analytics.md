# Analytics (Umami)

Code: `frontend/app/layout.js` (script), `frontend/components/Subscribe.js` (event), `frontend/app/privacy/page.js` (disclosure).

## The script

Umami Cloud, loaded with `next/script` (`strategy="afterInteractive"`):

- only when `NODE_ENV=production` (`npm run dev` does not load it);
- `data-domains="silentship.dev"` — Umami counts visits only on the production domain, so a local
  `npm start` or a test instance does not pollute the stats.

Umami sets no cookies and stores no IP addresses — no consent banner needed; `/privacy` says so ("What we
collect" and "Who processes it").

## The `subscribe` event

`window.umami?.track("subscribe", { beta })` — **after** `POST /api/subscribe` succeeded, so failed attempts
(400/429) are not counted. In the Umami dashboard this gives the visit → subscription conversion by source.
The `?.` means an ad blocker or dev mode without the script cannot break the form.

## Ad blockers

Some developers block `cloud.umami.is`. If the numbers look suspiciously low, proxy the script through the
own domain via rewrites in `next.config.mjs` and set `data-host-url`. `/api/send` is taken by the backend
proxy (`/api/*`), so use another path, e.g. `/stats/script.js` with
`data-host-url="https://silentship.dev/stats"` (the script posts to `<host-url>/api/send` →
`/stats/api/send`). Not done yet — [`../tasks/PLAN.md`](../tasks/PLAN.md).

## Checking

After a deploy, open the site and check that the visit appears in the Umami dashboard (data arrives almost
immediately). Details — [`../VERIFY.md`](../VERIFY.md).
