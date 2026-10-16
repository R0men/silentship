# Frontend (Next.js)

Code: `frontend/` — Next.js 16 (App Router, Turbopack), React 19, JavaScript. Port 3000.

> Next 16 has breaking changes compared with older versions. Before editing, read the docs bundled in
> `node_modules/next/dist/docs/` (see `frontend/AGENTS.md`).

## Pages

| Route | File | Rendering |
|---|---|---|
| `/` | `app/page.js` — headline with live numbers, subscribe form, channel status, rollout feed | SSR on every request (`force-dynamic`) |
| `/rollouts/[channel]/[group]` | `app/rollouts/[channel]/[group]/page.js` — share, facts, hosts, API changes | SSR on every request |
| `/reference` | `app/reference/page.js` — hub: every API type changed by a confirmed rollout, by namespace | SSR on every request |
| `/reference/[type]` | `app/reference/[type]/page.js` — one API type: state per channel, advice, change history, related types; wording in `lib/apiType.js` ([`seo.md`](seo.md)) | SSR on every request |
| `/privacy` | `app/privacy/page.js`; operator details in `lib/site.js` | static at build time |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/opengraph-image` | [`seo.md`](seo.md) | — |

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

**Headline with live numbers** (`components/Headline.js`): "Microsoft is rolling out Office.js 16.0.20606
right now. 42% of the CDN already serves it." There are variants for a beta rollout and for quiet times. The
wording is deliberately about the CDN's share, not users': we measure edge responses, and a user gets the
new version when Office next loads the add-in from such an edge.

## Design

Dark and flat — no component backgrounds or boxes; hierarchy comes from type (Inter, JetBrains Mono),
spacing and thin dividers. The hero has a pseudo-3D torus knot of white dots on a 2D canvas (`Scene.js`,
perspective projection, no WebGL or dependencies) that stops when off-screen and under
`prefers-reduced-motion`. The product name in the UI is **silentship** (`silentship.dev` only as an address).
