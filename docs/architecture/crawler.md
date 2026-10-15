# Crawler and sampling

Code: `backend/src/crawler/{loader,manifest,fetcher,build}.js`; orchestration — `runChannel` in
`backend/src/pipeline/run.js`. Why it works this way — [`cdn-facts.md`](cdn-facts.md).

## Channels and the manifest

- Channels: `prod` → `https://appsforoffice.microsoft.com/lib/1/hosted/`, `beta` → `/lib/beta/hosted/`
  (`CHANNEL_BASE_URL` in `backend/src/config.js`, selected with `CHANNELS`).
- **The loader goes first.** `parseLoader` reads the version map and `OSF.ConstantNames` from `office.js`;
  `buildManifest` generates every host file plus the dependencies (`LOCALES`, default `en-us`).
- The manifest is the **union** of the manifests of every loader version the edges returned, plus the
  stable version from the archive: a new loader can add a host.
- An empty map in every loader fails the run with `HostSpecificFileVersionMap not found…` (the format changed).

## Build stamp of each file

`backend/src/crawler/build.js` looks for explicit markers: `/* osfweb version: X */` (Outlook),
`// host: 16.0\X` (PowerPoint/OneNote/Visio), `hostJSVersion="X"` (Excel/Word), `FileVersion:"X"` (loader).
A plain `16.0.x.x` search does not work: Outlook contains older minimum-version constants, and the loader
contains `16.0.0000.0000`. Strings, telemetry, the mapping table and Project have no build (`null`).

## Samples

- **`SAMPLES` samples per file per run** (default 8), each on a new TCP/TLS connection (`https.get` with
  `agent: false`). Keep-alive would keep us on one edge server. Verified: separate connections land on
  different servers, and even one server can return different versions.
- **No query parameters.** A unique parameter busts the CDN cache and goes to the origin, which always has
  the newest version: the edge share could not be measured, and it would load Microsoft's origin.
- **Conditional requests.** Every sample sends `If-Modified-Since` = the latest `Last-Modified` of the
  stable version. An edge with the old version answers `304` with no body; a body comes only from edges
  with a newer version. Measured: a baseline run is ~37 MB per channel, ~4 MB during an active rollout and
  almost nothing when quiet.
- **Full refresh.** Every `FULL_REFRESH_HOURS` (6) the first sample of each file is unconditional — a check
  of the stable version itself.
- **Retries:** up to 3 retries per sample (up to 4 attempts) with exponential backoff of 0.5/1/2 s on
  network errors and on 408, 425, 429 and 5xx; 30 s timeout. Files are fetched in parallel
  (`FETCH_CONCURRENCY`, 6).

## HTTP metadata

`extractMeta` in `fetcher.js` keeps `Last-Modified`, `Akamai-Request-BC` (giving `edgeIp`),
`Akamai-Cache-Status`, `X-CDN-Provider`, `x-ms-request-id`. A per-file summary of each run goes to the
`snapshots` collection ([`data.md`](data.md)).

## Steps of one run (`runChannel`)

1. Loader × `SAMPLES` → manifest.
2. Every other file × `SAMPLES`.
3. Per file: `tallySamples` → `planFile` ([`rollouts.md`](rollouts.md)).
4. Archive the bodies of stable versions and of new rollout targets.
5. Analyse new rollouts against the stable loader ([`api-surface.md`](api-surface.md)); the formatted
   version goes to the archive.
6. One `git commit` per run if anything was added.
7. Write rollouts, API changes, file states, snapshots and the run summary to MongoDB.
