/**
 * Build number embedded in a CDN file. Every host file carries one, in one of several formats:
 *   Outlook:                /* osfweb version: 16.0.20410.15200 *\/
 *   PowerPoint/OneNote/Visio:  // host: 16.0\16.0.20528.15060
 *   Excel/Word (and others):   t.hostJSVersion="16.0.20528.15060"
 *   loader (office.js):        FileVersion:"16.0.20528.15060"
 * Explicit markers win: Outlook files also contain older "minimum version" constants that would fool a
 * plain search. Strings, telemetry and mapping files have no build; they return null.
 */

const BUILD = String.raw`16\.0\.\d{4,5}\.\d{4,5}`;

const MARKERS = [
  new RegExp(String.raw`osfweb version:\s*(${BUILD})`),
  new RegExp(String.raw`//\s*host:\s*16\.0\\(${BUILD})`),
  new RegExp(String.raw`hostJSVersion\s*=\s*"(${BUILD})"`),
  new RegExp(String.raw`FileVersion\s*:\s*"(${BUILD})"`),
];

const ANY = new RegExp(String.raw`(?<![\d.])(${BUILD})(?![\d.])`, "g");

/** Numeric order of "16.0.20606.15070"-style stamps. */
export function compareBuilds(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Number.isNaN(d) ? a.localeCompare(b) : d;
  }
  return 0;
}

export function extractBuild(source) {
  for (const marker of MARKERS) {
    const m = marker.exec(source);
    if (m) return m[1];
  }
  // Fallback for unknown formats: the newest stamp mentioned (older ones are minimum-version constants).
  let best = null;
  for (const [, build] of source.matchAll(ANY)) {
    if (/\.0000\.0000$/.test(build)) continue;
    if (best === null || compareBuilds(build, best) > 0) best = build;
  }
  return best;
}
