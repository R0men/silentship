# Contributing

Thanks for looking. Issues and pull requests are welcome — especially when the CDN does something the
crawler does not expect.

## Before you start

- Read [`TECH.md`](TECH.md) (scope and decisions) and the module you are touching in
  [`docs/architecture/`](docs/architecture/README.md).
- For anything larger than a fix, open an issue first so we can agree on the approach.

## Running it

```sh
npm install
cp .env.example .env
npm run dev   # in-memory MongoDB, no keys needed
npm test
npm run build
```

Details: [`docs/SETUP.md`](docs/SETUP.md); manual checks per component: [`docs/VERIFY.md`](docs/VERIFY.md).

## Ground rules

- **Never commit Microsoft's code.** No downloaded Office.js files, fragments of them, or reflection output
  in fixtures. Tests use small synthetic fixtures written by hand.
- **Code from the CDN runs only in the sandboxed worker** (`surface-runner.js`). Do not widen its
  permissions or execute such code in the main process.
- **No query strings in CDN requests** — they bypass the edge cache and measure the origin instead.
- **Group numbers come from `listGroups`** (`backend/src/web/queries.js`) only.
- If reflection output changes, bump `SURFACE_CACHE` in `backend/src/pipeline/run.js`.
- A change in behaviour comes with the matching update in `docs/` in the same pull request.
- Code style: Prettier with `--print-width 120`, ESM, comments explain *why*, not *what*.
- Commit messages: short imperative subject, e.g. `Handle 404 for retired host files`.

## Pull requests

CI runs `npm ci`, `npm test` and `npm run build` on every pull request; deploys happen only from `main` on
the maintainer's side. Keep pull requests focused on one change.
