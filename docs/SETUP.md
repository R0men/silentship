# SETUP.md — running locally and deploying

## Local development

Needs Node.js ≥ 22 and `git` (the archive of CDN files is a git repository).

```sh
npm install
cp .env.example .env
npm run dev               # backend on a throwaway in-memory MongoDB + `next dev`
```

- `npm run dev` needs no `MONGODB_URI`: `cli.js dev` starts `mongodb-memory-server`, and the data is gone
  on exit. The first crawl starts right away (~1 min per channel, ~37 MB), then follows `CRON`.
- Site: `http://localhost:3000`; API: `http://127.0.0.1:4000` (localhost only).
- Without `BREVO_API_KEY`, emails (including subscription confirmations) are printed to the backend console.
- Umami is not loaded in dev (production only).

Other commands:

```sh
npm test                  # vitest, synthetic fixtures only
npm run build             # build the frontend
npm start                 # backend (API + scheduled crawls) and frontend together; needs MONGODB_URI
npm run crawl             # one run of every channel (the first records a baseline); needs MONGODB_URI
npm run serve -w backend  # API only, no crawls (safe against a production database)
npm run watch -w backend -- you@company.com "Excel.Range.*" excel   # add a watchlist entry
node backend/src/cli.js mail-preview you@company.com                 # preview emails (needs BREVO_API_KEY)
```

> ⚠️ `npm start` and `npm run crawl` on your machine against a **production** `MONGODB_URI` write to the same
> database as production, but into your **local** `data/archive`. The archives diverge: production will not
> have the bodies of versions seen locally and will skip their API diffs. For local crawls use `npm run dev`
> or a separate database (`MONGODB_DB`).

## Environment variables

One `.env` at the repository root serves both workspaces; the template is `.env.example`.

| Variable | Default | What |
|---|---|---|
| `MONGODB_URI` | — (required for `start`/`crawl`/`serve`/`watch`) | MongoDB (e.g. Atlas) |
| `MONGODB_DB` | the URI path, else `silentship` | database name |
| `ARCHIVE_DIR` | `./data/archive` | private git archive of CDN files |
| `REGION` | `local` | region tag on all data (e.g. `eu`) |
| `CHANNELS` | `prod,beta` | which channels to crawl |
| `CRON` | `*/10 * * * *` | crawl schedule |
| `FULL_REFRESH_HOURS` | `6` | how often the first sample is unconditional |
| `SAMPLES` | `8` | samples per file per run (share precision = 1/SAMPLES) |
| `FETCH_CONCURRENCY` | `6` | files fetched in parallel |
| `LOCALES` | `en-us` | whose `office_strings.js` to track |
| `WORKER_MAX_MB` | `1024` | heap of the isolated reflection worker |
| `ALERT_QUIET_MINUTES` | `20` | quiet time in a channel before alerts go out |
| `API_PORT` / `API_HOST` | `4000` / `127.0.0.1` | API address (not `PORT`: Next reads that one) |
| `TRUST_PROXY` | `loopback` | who may set `X-Forwarded-For` |
| `HEALTH_STALE_MINUTES` | `20` | threshold for a 503 from `/health` |
| `MAX_CONFIRMATIONS_PER_HOUR` | `200` | global cap on confirmation emails |
| `PUBLIC_URL` | `http://localhost:3000` | site address: links in emails and RSS, canonical URLs, sitemap |
| `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` | — | email via Brevo |
| `SLACK_WEBHOOK_URL` | — | Slack alerts |
| `API_URL` (frontend) | `http://127.0.0.1:$API_PORT` | where Next fetches data |

## Production (one VPS)

The reference deployment is one small Ubuntu VPS (2 vCPU, 2 GB RAM is enough) with nginx in front and
MongoDB elsewhere (e.g. Atlas). Both apps run as one systemd service under an unprivileged user
(`silentship` below); the code is a git checkout of `main` in that user's home.

| What | Where |
|---|---|
| Code | `/home/silentship/silentship` (git checkout of `main`) |
| Secrets | `/home/silentship/silentship/.env` (mode 600) — written by hand, never in git |
| CDN archive | `/home/silentship/silentship/data/archive` |
| systemd unit | `/etc/systemd/system/silentship.service` (template: `deploy/silentship.service`) |
| nginx | `/etc/nginx/sites-enabled/silentship` (template: `deploy/nginx-silentship.conf`), TLS via certbot |

### First-time server setup

```sh
# Node 22, git, nginx, certbot
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
sudo useradd --create-home --shell /bin/bash silentship

# as the silentship user
git clone https://github.com/R0men/silentship.git ~/silentship
cd ~/silentship && npm ci && cp .env.example .env && chmod 600 .env && nano .env && npm run build

# as a sudo user
sudo cp deploy/silentship.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now silentship
sudo cp deploy/nginx-silentship.conf /etc/nginx/sites-available/silentship
sudo ln -s /etc/nginx/sites-available/silentship /etc/nginx/sites-enabled/
sudo certbot --nginx -d silentship.dev -d www.silentship.dev
sudo nginx -t && sudo systemctl reload nginx
```

In the production `.env`, set at least `MONGODB_URI`, `PUBLIC_URL=https://<your domain>`, `REGION`,
`BREVO_API_KEY` and `MAIL_FROM_EMAIL` (an address on a domain verified in Brevo). If MongoDB is Atlas, allow
the server's IP in Atlas → Network Access.

### Automatic deploys

A push to `main` runs `.github/workflows/ci.yml`: `npm ci` → `npm test` → `npm run build` → the `deploy`
job (environment `production`, `main` only) connects over SSH as the service user and passes the commit sha.
The GitHub Actions key is limited in `~/.ssh/authorized_keys` to a forced command:

```
restrict,command="bash /home/silentship/silentship/deploy/deploy.sh" ssh-ed25519 AAAA… github-actions-silentship
```

so that key can only deploy a commit that is already on `origin/main`. `deploy/deploy.sh`: `git fetch` →
check the sha is on `origin/main` → `git reset --hard` → `npm ci` (only when `package-lock.json` changed) →
`npm run build` → wait for a running crawl to finish (restarting mid-commit would leave an `index.lock` in
the archive) → restart → wait until the API and the site respond.

**Restart:** the script runs `sudo -n systemctl restart silentship`, allowed by one sudoers line:

```sh
echo 'silentship ALL=(root) NOPASSWD: /usr/bin/systemctl restart silentship' | sudo tee /etc/sudoers.d/silentship-deploy
sudo chmod 440 /etc/sudoers.d/silentship-deploy && sudo visudo -c
```

Without that rule it stops the unit's main process instead, and `Restart=always` brings it back with the
new build (~5 s).

**GitHub Secrets** (environment `production`): `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (the GitHub Actions
private key), `VPS_KNOWN_HOSTS` (the output of `ssh-keyscan -t ed25519 <host>`, pinned so a swapped server
is rejected). Restrict the environment's deployment branches to `main`.

A private fork can be pulled with a read-only deploy key: generate one for the service user, add it in
GitHub → Settings → Deploy keys, and point `origin` at an SSH host alias in `~/.ssh/config`.

Manual deploy without a push:

```sh
gh workflow run ci.yml --ref main
# or on the server:
bash ~/silentship/deploy/deploy.sh "$(git -C ~/silentship rev-parse origin/main)"
```

Logs: the repository's Actions tab; on the server `sudo journalctl -u silentship -f`.

## Monitoring

- **UptimeRobot** (free): an HTTP monitor on `https://<domain>/health` every 5 min, alerting on non-2xx.
  `/health` returns 503 when a channel has not finished a run for 20 min, the last run failed or a run is
  stuck — not only when the process is down.
- Optionally a second monitor on the site itself.
- Umami — visits and the `subscribe` event (`architecture/analytics.md`).
- Google Search Console / Bing Webmaster Tools — indexing, sitemap (`architecture/seo.md`).

## Email (Brevo) and DNS

Brevo → Senders, Domains & Dedicated IPs → add your domain. Brevo shows the exact records:

| Record | Purpose |
|---|---|
| Brevo verification TXT | proves you own the domain |
| DKIM (`brevo._domainkey` or as shown) | signs mail; required by Gmail/Yahoo |
| SPF TXT on `@`: `v=spf1 include:<value Brevo shows> ~all` | one SPF record per domain: merge with any existing one |
| DMARC TXT on `_dmarc`: `v=DMARC1; p=none; rua=mailto:dmarc@<domain>` | start with `p=none`, move to `quarantine` after a few clean weeks |

## Backups

- MongoDB — the provider's backups (Atlas has them).
- The `data/archive` archive is the history of every Office.js version seen; it cannot be downloaded again
  later. Nightly, e.g.
  `git -C ~/silentship/data/archive bundle create /backup/archive-$(date +%F).bundle --all`, copied off the server.
