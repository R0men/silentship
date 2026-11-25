/**
 * Validation of a subscriber's alert settings, as sent by the /settings page (POST /api/settings).
 * Pure: the route stores what this returns. Matching of the watchlist is analysis/watchlist.js.
 */

import { APPS } from "../analysis/apps.js";

/** Host types a watch can be narrowed to (`hostTypeOf` of the CDN's host files). */
export const WATCH_HOSTS = ["excel", "word", "powerpoint", "onenote", "visio"];

const CHANNELS = ["prod", "beta"];
const SEVERITIES = ["low", "medium", "high"];
export const MAX_WATCH_ITEMS = 50;
const MAX_PATTERN = 120;

/** "Excel.Range", "Excel.Range.getCell", "Office.context.ui.*", "Excel.*": dotted identifiers, optional ".*". */
const PATTERN = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(\.\*)?$/;

const fail = (error, detail) => ({ error, ...(detail !== undefined && { detail }) });

/**
 * { settings } or { error, detail }: channels, minSeverity, apps and watchItems, normalised and deduplicated.
 * `apps` narrows alerts to the API of these applications (analysis/apps.js); empty, or every one, means all.
 */
export function parseSettings(body) {
  if (!body || typeof body !== "object") return fail("invalid_body");

  const channels = Array.isArray(body.channels) ? [...new Set(body.channels)] : null;
  if (!channels?.length || !channels.every((c) => CHANNELS.includes(c))) return fail("invalid_channels");

  if (!SEVERITIES.includes(body.minSeverity)) return fail("invalid_severity");

  const chosen = body.apps ?? [];
  if (!Array.isArray(chosen) || !chosen.every((a) => APPS.includes(a))) return fail("invalid_apps");
  const apps = chosen.length && new Set(chosen).size < APPS.length ? APPS.filter((a) => chosen.includes(a)) : [];

  const items = body.watchItems ?? [];
  if (!Array.isArray(items)) return fail("invalid_watchlist");
  const watchItems = [];
  const seen = new Set();
  for (const item of items) {
    const pattern = String(item?.pattern ?? "").trim();
    if (!pattern) continue; // an empty row in the form
    if (pattern.length > MAX_PATTERN || !PATTERN.test(pattern)) return fail("invalid_pattern", pattern.slice(0, MAX_PATTERN));
    const hosts = Array.isArray(item.hosts) ? [...new Set(item.hosts)].sort() : [];
    if (!hosts.every((h) => WATCH_HOSTS.includes(h))) return fail("invalid_hosts", pattern);
    const key = `${pattern.toLowerCase()}\u0000${hosts.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    watchItems.push({ pattern, hosts });
  }
  if (watchItems.length > MAX_WATCH_ITEMS) return fail("too_many_patterns", MAX_WATCH_ITEMS);

  return { settings: { channels: CHANNELS.filter((c) => channels.includes(c)), minSeverity: body.minSeverity, apps, watchItems } };
}
