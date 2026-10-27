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
npm run reclassify -w backend                                        # classify stored API changes saved without a status (start does it too)
```

> ⚠️ Keep the production `MONGODB_URI` out of your local `.env`. `npm start` and `npm run crawl` on your
> machine against it write to the production database but into your **local** `data/archive`: the archives
> diverge, and production will not have the bodies of versions seen locally and will skip their API diffs.
> The crawl lock stops two crawls from overlapping, not this. Locally use `npm run dev` (in-memory) or a
> separate database. For reading production data from scripts, use a MongoDB user with the `read` role only.

## Environment variables

One `.env` at the repository root serves both workspaces; the template is `.env.example`.

| Variable | Default | What |
|---|---|---|
| `MONGODB_URI` | — (required for `start`/`crawl`/`serve`/`watch`) | MongoDB (e.g. Atlas) |
| `MONGODB_DB` | the URI path, else `silentship` | database name |
| `ARCHIVE_DIR` | `./data/archive` | private git archive of CDN files |
| `REGION` | `local` | region tag on all data (e.g. `eu`) |
| `CHANNELS` | `prod,beta,onecdn-prod,onecdn-beta` | which channels to crawl, in this order ([`crawler.md`](architecture/crawler.md)) |
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
| `MAIL_REPLY_TO` | — | Reply-To of the confirmation and welcome emails (e.g. `hello@<domain>`) |
| `SLACK_WEBHOOK_URL` | — | Slack alerts |
| `HEALTHCHECK_URL` | — | dead-man's switch: `GET` after every crawl where all channels finished, `<url>/fail` after one with a failed channel (healthchecks.io format; 5 s timeout, a failed ping is only logged) |
| `BACKUP_DIR` | `~/backups` | `deploy/backup.sh`: where dumps go |
| `BACKUP_RCLONE_REMOTE` | — | `deploy/backup.sh`: rclone destination for an off-site copy (e.g. `b2:silentship-backups`) |
| `ARCHIVE_REMOTE` | — | `deploy/backup.sh`: **private** git remote the archive is pushed to |
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
- **healthchecks.io** (free): a check with period 10 min and grace 20 min, notifications by email or
  Telegram; its ping URL goes into `HEALTHCHECK_URL`. Pings come from inside the crawler, so this also
  catches what `/health` cannot report by itself: the whole server or service being down, or the crawler
  hanging. A crawl with a failed channel pings `<url>/fail` and alerts at once.
- Optionally a second monitor on the site itself.
- Umami — visits and events (`architecture/analytics.md`).
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

`deploy/backup.sh`, run nightly at 03:17 UTC by `deploy/silentship-backup.timer`:

1. `mongodump --archive --gzip` of the database into `$BACKUP_DIR/daily/silentship-<date>.archive.gz`
   (the URI goes through a 0600 config file, never the command line); on Sundays a copy in `weekly/`;
2. rotation: the 14 newest daily and 8 newest weekly dumps stay;
3. with `BACKUP_RCLONE_REMOTE` — `rclone sync` of both folders off the server; without it a warning in the log;
4. with `ARCHIVE_REMOTE` — `git push` of `data/archive` (HEAD → `main`) to that remote. The archive is
   the history of every Office.js version seen and cannot be downloaded again later. It holds Microsoft's
   code: the remote must be private.

Settings come from the environment or the repository's `.env` (`MONGODB_URI`, `MONGODB_DB`, `ARCHIVE_DIR`
and the variables above). Setup, once:

```sh
# MongoDB Database Tools (mongodump, mongorestore) and, for the off-site copy, rclone
sudo apt install mongodb-database-tools rclone   # or the .deb from mongodb.com/try/download/database-tools
rclone config                                     # as the silentship user: e.g. a Backblaze B2 or R2 remote
sudo cp ~/silentship/deploy/silentship-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now silentship-backup.timer
sudo systemctl start silentship-backup && journalctl -u silentship-backup -n 20   # one run now
```

### Restore

```sh
# Into a scratch database first, to look at it (namespaces renamed on the way in):
mongorestore --uri="$MONGODB_URI" --gzip --archive=silentship-2026-10-27.archive.gz   --nsFrom='silentship.*' --nsTo='silentship_restore.*'
# Over the live database: stop the service first, then
mongorestore --uri="$MONGODB_URI" --gzip --archive=silentship-2026-10-27.archive.gz --drop
# The archive: clone the private remote back into ARCHIVE_DIR
git clone "$ARCHIVE_REMOTE" ~/silentship/data/archive
```

Checked on 2026-10-27 locally against a throwaway MongoDB (not production): `backup.sh` produced the dump,
rotated 21 daily files down to 14, and `mongorestore` into `silentship_restore` gave the same document
count in every collection (250 / 2 / 1). `--nsFrom/--nsTo` needs the database name in the URI or
`MONGODB_DB` to match the dumped one (`silentship` here).
