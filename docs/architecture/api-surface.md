# API surface, diff and severity

Code: `backend/src/analysis/` — `surface-runner.js` (isolated process), `surface-worker.js`, `sandbox.js`
(stubs), `surface.js` (traversal), `fn-hash.js` (`bodyHash`), `diff.js`, `classify.js` (renames, status),
`api-catalog.js` (catalogue from `@types`). Called from `analyzeRollout` in `backend/src/pipeline/run.js`.

## Why not a static AST

The code is minified: classes are `n.prototype.applyFilter=function(e){…}` inside closures; rebuilding
`Excel.PivotField.applyFilter` statically would mean interpreting the bundle. Reflecting the live objects
gives the exact tree.

## How the surface is taken

1. The file runs in `node:vm` inside a **child process** with a timeout (90 s) and a memory limit
   (`WORKER_MAX_MB`, 1024). `vm` is not a security boundary: code can easily reach the real `process`
   through outer-realm objects (verified). So the worker is locked down:
   - **empty environment** (`env: {}`; only `SystemRoot` on Windows) — `MONGODB_URI`, `BREVO_API_KEY` and
     other secrets are not there to read;
   - **Node permission model** (`--permission`): it may read only its own code, `node_modules` and the
     files under analysis; writes, child processes, worker threads and native addons are denied (verified
     with an escape script: `ERR_ACCESS_DENIED`);
   - Node 22's permission model does not restrict the network yet — if needed, do it at the OS level (firewall).
   Workers run one at a time: each may use up to `WORKER_MAX_MB`, and small VPSes have little RAM.
2. Global stubs: `window/self/top`, `document` as a "deep" Proxy (any property is a no-op function/object),
   timers are no-ops.
3. Roots traversed: `Office, OfficeExtension, Excel, Word, PowerPoint, OneNote, Visio, OfficeCore, Outlook`
   + `OSF.DDA.AsyncMethodNames/SyncMethodNames` (where names such as `displayDialogAsync` live).
4. Members prefixed with `_` are internal and skipped. Cycles are handled with a `WeakMap` (a repeated
   object is written as a `ref` to its first path).
5. Node kinds:
   - `class` — a function with own prototype members; prototype and static members become children;
   - `function` — `arity` (`fn.length`) + `bodyHash`;
   - `property` — an accessor on a prototype (get/set);
   - `enum` — an object whose values are all strings/numbers; the values are kept;
   - `namespace` — any other object, recursed into (depth ≤ 8);
   - `value` — a primitive; only its type is kept.
6. The result is a flat map `path → node` (`Excel.Range.getCell` …), cached in the archive as
   `surfaces/v2/<sha>[@<loaderSha12>].json` together with any execution error. When reflection changes, bump
   the cache version (`SURFACE_CACHE` in `run.js`).

**`bodyHash` without minifier noise.** Between builds the minifier renames local variables, so a hash of
the raw `fn.toString()` would always change. Normalization: tokenize the body with `@babel/parser`, replace
identifiers with `$` **except** property names after `.` and object keys; strings and numbers stay. The
hash is sha256 of the normalized token stream.

**Loader first.** Host files expect `office.js` to have run already (`OSF._OfficeAppFactory` etc.). Without
the loader PowerPoint web gave 60 paths, with it ~2,000. So the host file runs after the loader, and entries
identical to the loader's own surface are removed from the result (they belong to `office.js`; otherwise
every loader change would repeat in ~40 host files). Both sides of a diff (from and to) are reflected with
the current stable loader, so the difference comes from the host file only. The `document.currentScript`
stub points at the CDN path, because otherwise the loader refuses to initialize. Unknown globals
(`HTMLScriptElement is not defined`) are stubbed automatically and the run is retried.

**Metadata-built classes (since 16.0.20606).** Newer builds no longer describe `Excel.Range` and other
classes in code. Each class is a shared stub that builds its prototype from metadata
(`["getCell","Range",2,…]`) the first time an instance is created. Without handling this, reflection saw 672
`Excel.*` members instead of ~4,000, and 20528 → 20606 would have produced thousands of false "removed". So
before traversal every such stub is instantiated once with dummy arguments (`materializeLazyClasses`).

**Generated wrappers.** Methods of such classes are one and the same function with `length = 0` and a
shared body. If a body is shared by at least 5 members (`GENERIC_MIN_SHARED`), the node is marked `generic`,
and only its appearance and disappearance are compared, not arity or body.

Result on production (2026-10-14): Excel/Word ≈ 5,000–5,500 paths, PowerPoint/OneNote ≈ 2,000, Visio ≈ 1,500,
Outlook ≈ 20–45.

**Limitation** (in the spirit of `TECH.md` §0): Outlook's `mailbox` is created only after the host
initializes, so for Outlook we see classes, enums and DDA method names, but not the full
`Office.context.mailbox.item` tree.

## An incomplete reflection never produces High

In `diffReflections` (`diff.js`):
- the new side failed differently from the old one (error text compared without file names), or shrank by
  more than 40% (`SHRINK_LIMIT`) without an error → `removed` changes are not reported;
- the same for the old side → `added` changes are not reported;
- the reason is stored on the rollout as `apiDiffNote`.

Checked on the live `SensitivityLabelAbac*` case (beta, 20528 → 20606): no errors, no shrinkage, and the
exact names `SensitivityLabelAbacAttribute` / `SensitivityLabelUpdateResult` are absent from the text of
every 20606 file while present in 20528. So the removal is real.

## Diff and severity

| Change | Severity |
|---|---|
| node removed | High |
| `kind` or `arity` changed | High |
| enum value removed or changed | High |
| `bodyHash` of a public function/method changed | Medium |
| enum value added, new node | Low |
| class constructor (add-ins do not call it) | Low |
| non-host file changed (strings, telemetry, o15 map) | Low (file level) |

A rollout's severity is the maximum over its API changes; a removed file is High, a new file Low. A new
`office.js` whose security-default flags changed is High whatever its API changes (`loader-flags-changed`,
[`alerts.md`](alerts.md)). A failed
analysis or a missing previous version in the archive → Low without API changes (logged).

## API status from the official types

`api-catalog.js` builds a catalogue "path → status + requirement set" from `@types/office-js` (GA) and
`@types/office-js-preview` (~17,500 paths, ~800 of them preview; ~0.7 s to parse, once per process). Every
change gets `apiStatus` (`ga` / `preview` / `undocumented`) and `apiSet` (`ExcelApi 1.4`):
- High and Medium remain only for GA APIs;
- changes to preview APIs (`[Api set: … BETA (PREVIEW ONLY)]`, `@beta`) are Low, tagged "preview": Microsoft
  explicitly warns they may change;
- undocumented members (present at runtime, absent from the types) are Low too.

The types are updated with the dependencies (`npm update -w backend`).

**Stored changes without a status.** Changes saved before classification existed (the beta rollout of
16.0.20606.15070, first seen 2026-10-14) have no `apiStatus` and keep the raw diff's severity — preview
removals showed as High. `reclassifyStored` (`analysis/reclassify.js`) classifies every row with
`apiStatus: null` and lowers the severity of its rollouts to match; it never raises one, so the guard against
High from an incomplete reflection holds. `cli start` runs it at boot; `npm run reclassify -w backend` runs it
alone. Idempotent: a second run finds nothing. Alerts already sent are not resent.

The catalogue is also read by the web API: `/api/types/:type` returns the type's current status, requirement
set and Microsoft Learn page (`learnUrl`: `learn.microsoft.com/en-us/javascript/api/<host>/<type>`, with the
preview view for preview types; only for documented types whose path is all PascalCase after the root, since
functions and objects such as `Office.context.ui` have no page of their own).

## Renames

`classify.js`: a "removed + added" pair with the same parent and the same node kind becomes one `renamed`
change if their enum values match or the names are similar enough (Levenshtein: ≥ 0.75 for classes, enums
and namespaces, ≥ 0.85 for members, because `getItem` / `getItemAt` are different methods). Severity follows
the status of the old name: that is what add-in code depends on.
