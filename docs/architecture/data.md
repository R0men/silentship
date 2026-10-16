# Data: MongoDB and the git archive

Code: `backend/src/db.js` (connection, indexes), `backend/src/archive/git-archive.js`.

## MongoDB

Official `mongodb` driver, no ORM. Database name: `MONGODB_DB`, else the path of `MONGODB_URI`, else
`silentship`. Indexes are created on connect (`ensureIndexes`).

| Collection | What | Indexes |
|---|---|---|
| `runs` | One crawl of a channel: stable loader build, requests, bytes, rollouts created/completed, stale samples, status, error | `{channel, region, startedAt}` |
| `fileStates` | Per file: the stable version (sha, build, `Last-Modified` floor for conditional requests), `retiredShas` | unique `{channel, region, path}` |
| `rollouts` | channel, region, path, role, hostType/Platform, fromSha/fromBuild → toSha/toBuild, group, status, share, recentShare, peakShare, history[{at, share}] (up to 300 points), firstSeenAt, lastSeenAt, completedAt, severity, apiChangeCount, apiDiffNote, notifiedAt, rollbackNotifiedAt | `{channel, region, path, status}`, `{channel, group}`, `{firstSeenAt}`, `{notifiedAt}` |
| `apiChanges` | One row per changed API path in a rollout (there can be thousands): rolloutId, file, path, kind, severity, apiStatus, apiSet, before/after | `{rolloutId}`, `{path}`, `{from}` (the old name of a rename, for `/reference`) |
| `snapshots` | Per file per run: sample counts, variants `{sha, build, count, lastModified}`, edge IPs, bytes | `{channel, region, path, fetchedAt}`, TTL 90 days |
| `subscribers` | email, token, channels[], pendingChannels[] (a channel added by a confirmed address, until the click), minSeverity, `watchItems[]`, createdAt/confirmedAt/unsubscribedAt, confirmationsSent[] (any subscribe-form email) | unique `{email}`, `{token}` |
| `deliveries` | Alert outbox: key (`rollout:<channel>:<group>:<batch>` / `rollback:…`), kind, channel, group, transport (`email`/`slack`), subscriberId, to, rendered message, createdAt, sentAt, attempts, lastError, failedAt ([`alerts.md`](alerts.md)) | unique `{key, transport, subscriberId}`, `{sentAt, failedAt, createdAt}`, `{kind, channel, group, transport}`, TTL 90 days |

No multi-document transactions (they need a replica set). File states are written after rollouts, so a
failure mid-run leads to a retry, not to data loss.

## Git archive (`ARCHIVE_DIR`, default `data/archive`)

A private git repository with every version of every file we have seen. **Never published**: it contains
Microsoft's code (`TECH.md` §3). `/data` is in this repository's `.gitignore`.

```
blobs/ab/<sha256>                    raw content, content-addressed (shared by channels and regions)
surfaces/v2/<key>.json               reflection cache { surface, error }; key = sha or sha@loaderSha12
<channel>/<region>/formatted/<file>  prettier version of the newest content, so `git log -p` reads as a changelog
```

One commit per channel run (`prod/eu: 5 new rollout(s), 5 new file version(s)`). The archive cannot be
re-downloaded after the fact — back it up (`docs/SETUP.md`).
