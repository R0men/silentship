# VERIFY.md — manual checks

Automated tests (`npm test`) cover the pure functions on synthetic fixtures: loader parsing, manifest,
build stamps, rollout rules, `bodyHash`, reflection, diff/severity, watchlist, headers. Everything else is
checked by hand with these steps. Locally — `npm run dev` (or `npm run build && npm start`); in production —
the same requests against `https://silentship.dev`.

## 1. Health

```sh
curl -s http://127.0.0.1:4000/health
```
Expect `"ok": true` and `lastStatus: "ok"` for every channel after the first run. Right after start it is a
503 with `no finished crawl yet` — that is normal.

## 2. Crawl and rollouts

```sh
curl -s http://127.0.0.1:4000/api/overview      # build per channel, active groups
curl -s "http://127.0.0.1:4000/api/rollouts?limit=5"
```
After a run, `data/archive` has a new commit `prod/<region>: …` (`git -C data/archive log --oneline -3`).

## 3. Subscription

```sh
curl -s -X POST http://localhost:3000/api/subscribe -H 'content-type: application/json' -d '{"email":"you@example.com"}'
```
`{"ok":true}`; without `BREVO_API_KEY` the email with the `/confirm?token=…` link is in the backend console.
Opening the link shows a "Confirm" page and changes nothing; only the button confirms (`curl -s
"http://localhost:3000/confirm?token=…"` returns the page, the subscriber stays unconfirmed). The same for
`/unsubscribe?token=…`.
The sixth request within an hour from the same IP gets `429`.

### Email design

Where `BREVO_API_KEY` is set: `node backend/src/cli.js mail-preview <your address>` sends
`[preview] Confirm your silentship alerts` and `[preview] [high] Office.js …`. Check them in Gmail (web and
mobile) and Outlook: dark background, white button, coloured severity dots, monospace paths; links point to
`PUBLIC_URL`.

## 4. Live updates

```sh
curl -N http://localhost:3000/api/live
```
An `event: update` + `data: {...}` snapshot arrives right away, then `: ping` every 25 s and a new snapshot
when a run starts or finishes.

## 5. SEO

```sh
curl -s https://silentship.dev/robots.txt
curl -s https://silentship.dev/sitemap.xml
curl -s https://silentship.dev/ | grep -oE '<link rel="canonical"[^>]*>|<meta property="og:[a-z:]+"[^>]*>'
curl -sI https://silentship.dev/opengraph-image | head -3
curl -s https://silentship.dev/llms.txt
```
- `robots.txt`: `Disallow` for `/api/`, `/confirm`, `/unsubscribe`, `/health` and `Sitemap: https://silentship.dev/sitemap.xml`.
- `sitemap.xml`: valid XML with `/`, `/privacy`, `/reference`, one URL per group and one per API type from
  `/api/sitemap`; every `<loc>` is absolute.
- `/reference/<type>` of a changed type: title and h1 say what happened and on which channel; canonical is the
  exact identifier; a lower-case spelling answers 308 to it; a type that never changed — 404 and `noindex`.
  Every API row on a rollout page links to its type page.
- canonical and `og:url` are absolute; `og:image` is a 1200×630 PNG.
- `llms.txt`: `text/plain`, heading `# silentship`, absolute links, "Recent rollouts" matches the home page.
- A missing rollout page (`/rollouts/prod/nope`) — 404 and `noindex`.
- External: Google Rich Results Test / Search Console → Sitemaps.

## 6. Umami

In production, open the site → the Umami dashboard shows the visit almost immediately. Scroll to "Rollouts" — one
`view_rollouts` (not again after reloading the tab); click a rollout — `open_rollout` with `channel`, `severity`,
`from`; focus the email field — `subscribe_start` (once); subscribe — `subscribe`. Locally (`npm run dev`) the script is not loaded; with `npm start` it is, but
`data-domains` does not count `localhost`.

## 7. Deploy

After a push to `main`: Actions → CI → both jobs green; the last line of the `deploy` job is
`deployed <sha> <commit subject>`. On the server `git -C ~/silentship log -1 --oneline` is that commit.
