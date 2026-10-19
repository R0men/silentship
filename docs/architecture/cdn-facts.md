# What we found on the real CDN (2026-10-14)

The facts the crawler and the analysis are built on. If the CDN starts behaving differently, start here.

| Fact | Consequence for the design |
|---|---|
| The loader contains `OSF.HostSpecificFileVersionMap = {excel:{win32:"16.01",…},…}` — a plain object literal | Parsed with `@babel/parser`, nothing is executed |
| Host file name: `[hostType, hostPlatform, hostSpecificFileVersion, HostFileScriptSuffix].join("-") + ".js"`, lower-cased | The file list is generated from the map |
| The map value is a **ceiling**: `if (requested > map) use map`. Older hosts request lower versions (`16.00`) | For every host/platform pair we generate every version from `16.00` up to the map value; a 404 is a normal result and is simply recorded |
| `OSF.ConstantNames = {FileVersion:"16.0.20528.15060", OfficeStringJS:"office_strings.js", O15InitHelper:"o15apptofilemappingtable.js", …}` | Build stamp and dependency names come from there too |
| Dependencies: `{locale}/office_strings.js`, `o15apptofilemappingtable.js`, `telemetry/oteljs_agave.js`, `microsoftajax.js` | A fixed list of "extras" plus whatever the loader names |
| **No ETag**; there is `Last-Modified`, `Akamai-Request-BC` (edge IP + location), `Akamai-Cache-Status`, `X-CDN-Provider`, `x-ms-request-id` | All of these headers are stored; the edge IP is parsed from `Akamai-Request-BC` |
| Host files are ≈ 0.4–1.7 MB, minified | Downloading ~45 files in full on every run is too expensive → conditional requests ([`crawler.md`](crawler.md)) |
| `excel-win32-16.01.js` runs in `node:vm` with DOM stubs and yields 433 `Excel.*` members, prototypes with methods | The API surface is taken by **runtime reflection**, not static AST ([`api-surface.md`](api-surface.md)) |
| **Akamai edges serve different versions of the same file** (in Frankfurt, `Last-Modified` of 7, 9, 12 and 13 October at the same time); the loader is build `16.0.20528.15060` on some edges and `16.0.20606.15070` on others | Without protection the monitor would flap on every run → the rollout model ([`rollouts.md`](rollouts.md)) |
| Host files are updated **without a new build stamp** | The build stamp is one signal only; the primary signal is each file's sha |
| Identical bytes have different `Last-Modified` on different edges | `Last-Modified` does not identify a version; sha first, date second |
| An edge with older content answers `304` to `If-Modified-Since` of a newer date | Conditional requests are safe: they hide only stale edges, never new versions |
| **A second endpoint, `officeapis.public.onecdn.static.microsoft/{1,beta}/`** (checked 2026-10-19): Microsoft's docs (updated 2026-09-25) call `appsforoffice.microsoft.com` legacy and recommend it. Same infrastructure (Akamai in front, Azure Front Door origin, `max-age=14400`, `Last-Modified`, `304` on `If-Modified-Since`), same host files byte for byte, same build | Two more channels with the same sampling ([`crawler.md`](crawler.md)); one email per build ([`alerts.md`](alerts.md)) |
| Only `office.js` differs: the OneCDN one is the legacy one plus `isOsfSecurityDefaultsEnabled = true; osfLoadMsAjax = false;` in front. The loader then turns on Trusted Types and does not load MicrosoftAjax | Flags are read from every loader; a change is High (`loader-flags-changed`) — the legacy endpoint adopting them would break add-ins that use `Sys.*` |
| Both host names resolve through the same Traffic Manager / Front Door chain; from one network, 8 fresh connections to either landed on the same Akamai edge | No sign that OneCDN reaches fewer edges, so its shares carry no "less precise" note; to re-check from the server, compare the `a=` field of `Akamai-Request-BC` (not the connected IP, which is the same for both) |
