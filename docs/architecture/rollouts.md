# Rollouts

Code: pure functions `tallySamples` and `planFile` in `backend/src/pipeline/rollouts.js` (fully covered by
`backend/test/rollouts.test.js`); persistence — `backend/src/pipeline/run.js`.

## The entity

**A rollout of one new version of one file**: channel, region, path, `fromSha/fromBuild → toSha/toBuild`,
`firstSeenAt`, share, share history, status. Why: edges serve different versions at the same time
([`cdn-facts.md`](cdn-facts.md)), so "the file changed" is not an event but a process.

## Rules

- A version is a sha256; `null` means "no file" (404), so adding and removing a file are rollouts too.
- **Share** = the fraction of a run's samples that returned this version; a `304` counts for the stable
  one. The site shows the average over the last `SMOOTHING_RUNS` (6) runs: with 8 samples a single run
  moves in steps of 12.5%.
- A new sha **newer** than the stable one (build first, then `Last-Modified`) → a new rollout, archiving,
  API diff.
- An older or already retired (`retiredShas`) sha → a stale edge: counted as `stale`, no rollout is created.
- 100% in `COMPLETE_RUNS` (3) runs in a row → `complete`: the new version becomes stable, the old one goes
  to `retiredShas`.
- No sample for `ABANDON_MS` (24 h) → `abandoned` (pulled back). If the version returns within 30 days
  (`REVIVE_WINDOW_MS` in `run.js`), the rollout is revived.
- The share history keeps up to `HISTORY_LIMIT` (300) points.
- A new file of a known channel: the oldest version becomes stable, newer ones become rollouts right away
  (with a diff, since both bodies are at hand).
- **The first run of a channel** (`bootstrap`: no file of the channel has a state yet — a newly added
  endpoint) creates no rollouts at all: the **newest** version each file is served in becomes stable, older
  ones are stale edges. A release that is mid-rollout when the channel is added is not shown on it — the
  paired channel shows it — and no phantom groups or alerts appear.

## Groups

Rollouts of one build are grouped (`groupKey` in `run.js`): the key is `toBuild`; files without a build get
`sha-<12 chars>`; removals get `removed-<fromBuild|sha>-<path>`, one group per file. A file Microsoft drops
leaves the loader's manifest and is never sampled, so a 404 on a listed file is usually an incident of that
file; per-file keys keep two unrelated removals from one stable build off a shared page (and severity).
Keys created before 2026-10-15 lack the path. On the site one Microsoft release = one page
`/rollouts/<channel>/<group>` with the share per host file. Group numbers come only from `listGroups`
([`web.md`](web.md)). Group keys are internal: the site names a group by its build, or "Files removed" /
"Unversioned change" (`groupTitle` in `frontend/lib/format.js`).

A group is **confirmed** once any of its files completed or was sighted in `CONFIRM_RUNS` (2) runs. Only
confirmed groups alert and appear on the site ([`alerts.md`](alerts.md)).
