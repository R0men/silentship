# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/R0men/silentship/security/advisories/new). You will get an answer
within a few days; fixes are released as soon as they are ready, and you are credited unless you prefer not
to be.

## What is in scope

- **The reflection sandbox.** silentship executes JavaScript downloaded from the Office.js CDN to reflect its
  API surface (`backend/src/analysis/surface-runner.js`). That code runs in a separate process with an empty
  environment, the Node.js permission model (read-only access to its own code and the analysed file; no
  writes, child processes, worker threads or native addons), a memory cap and a timeout. Any way for such
  code to read secrets, write files, spawn processes or reach the main process is a vulnerability.
- **The public API** (`backend/src/web/server.js`): subscription abuse (rate limits, email flooding, address
  enumeration), token handling in `/confirm` and `/unsubscribe`, header spoofing around `X-Forwarded-For`.
- **The deploy path** (`.github/workflows/ci.yml`, `deploy/deploy.sh`): anything that lets someone other than
  a push to `main` run code on the server.
- **Email templates**: HTML injection through rollout data.

## Out of scope

- Breakages or changes in Office.js itself — report those to Microsoft
  ([OfficeDev/office-js](https://github.com/OfficeDev/office-js)).
- Missing rate limits on read-only public pages, and reports from automated scanners without a working impact.

## Not in this repository

Secrets (`.env`) and the archive of Microsoft's files (`data/archive`) are never committed. If you find
something that looks like a secret in the history, please report it privately as above.
