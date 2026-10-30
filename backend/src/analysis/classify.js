import { apiStatus } from "./api-catalog.js";

/**
 * Post-processing of a raw API diff:
 *  1. removed + added pairs that are really one rename become a single "renamed" change;
 *  2. every change gets the documented status of its API (GA / preview / undocumented) and its
 *     requirement set; only GA APIs keep high/medium severity. Microsoft states that preview APIs may
 *     change at any time, and undocumented members are internals add-ins should not use.
 */

const parentOf = (path) => path.slice(0, path.lastIndexOf("."));
const leafOf = (path) => path.slice(path.lastIndexOf(".") + 1);

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 1 = identical names, 0 = nothing in common. */
export function nameSimilarity(a, b) {
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
}

const sameValues = (x, y) =>
  JSON.stringify(Object.values(x ?? {}).sort()) === JSON.stringify(Object.values(y ?? {}).sort());

/**
 * How likely is `added` a rename of `removed`? Same parent and same kind are required. Enums with the
 * same set of values are a rename whatever the name; otherwise the names must be close — stricter for
 * members (getItem vs getItemAt are different methods) than for types.
 */
function renameScore(removed, added) {
  if (parentOf(removed.path) !== parentOf(added.path)) return 0;
  const a = removed.before;
  const b = added.after;
  if (!a || !b || a.kind !== b.kind) return 0;
  if (a.kind === "enum" && Object.keys(a.values ?? {}).length > 0 && sameValues(a.values, b.values)) return 1;
  const similarity = nameSimilarity(leafOf(removed.path), leafOf(added.path));
  const threshold = a.kind === "class" || a.kind === "enum" || a.kind === "namespace" ? 0.75 : 0.85;
  return similarity >= threshold ? similarity : 0;
}

/** Pair removed/added changes into renames, best matches first, each change used at most once. */
export function detectRenames(changes) {
  const removed = changes.filter((c) => c.kind === "removed");
  const added = changes.filter((c) => c.kind === "added");
  const candidates = [];
  for (const r of removed) {
    for (const a of added) {
      const score = renameScore(r, a);
      if (score > 0) candidates.push({ r, a, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);
  const used = new Set();
  const renames = [];
  for (const { r, a } of candidates) {
    if (used.has(r) || used.has(a)) continue;
    used.add(r);
    used.add(a);
    renames.push({
      path: a.path,
      from: r.path,
      kind: "renamed",
      // Code using the old name breaks exactly as with a removal.
      severity: r.severity,
      before: r.before,
      after: a.after,
    });
  }
  return [...changes.filter((c) => !used.has(c)), ...renames];
}

/**
 * Requirement sets that are production on some platforms only; every other set (ExcelApi, WordApi,
 * PowerPointApi, Mailbox, OneNoteApi…) counts as GA wherever its host runs. Platforms are `hostPlatform`
 * values from the loader's file map. Source: the requirement set pages on Microsoft Learn, e.g.
 * https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-desktop-1.3-requirement-set
 * ("production on Windows and Mac") and .../word/word-api-online-requirement-set ("web only").
 */
const GA_PLATFORMS = [
  [/^(WordApiDesktop|ExcelApiDesktop|PowerPointApiDesktop|WordApiHiddenDocument)\b/, ["win32", "mac"]],
  [/^(WordApiOnline|ExcelApiOnline|PowerPointApiOnline)\b/, ["web"]],
];

/** Is `apiSet` production on `platform`? true when either is unknown: only a known mismatch demotes. */
export function gaOnPlatform(apiSet, platform) {
  if (!apiSet || !platform) return true;
  const rule = GA_PLATFORMS.find(([re]) => re.test(apiSet));
  return !rule || rule[1].includes(String(platform).toLowerCase());
}

const DEMOTE = { high: "medium", medium: "low", low: "low" };

/**
 * A GA change in a file for a platform where its requirement set is not production is one level lower:
 * add-ins on that platform cannot rely on the set anyway. `platformNote` says why, when it lowered anything.
 */
export function platformSeverity({ severity, apiSet }, platform) {
  if (gaOnPlatform(apiSet, platform)) return { severity, gaOnPlatform: true, platformNote: null };
  const lowered = DEMOTE[severity] ?? severity;
  return {
    severity: lowered,
    gaOnPlatform: false,
    platformNote: lowered !== severity ? `${apiSet} is not GA on ${String(platform).toLowerCase()}` : null,
  };
}

/**
 * Attach API status and requirement set; demote everything that is not GA to low, and GA changes one level
 * where their set is not production on the file's `platform` (null for files without one, e.g. office.js).
 */
export function classifyChanges(changes, statusOf = apiStatus, platform = null) {
  return changes.map((c) => {
    // The side that existing add-ins depend on decides: the old name for removals and renames.
    const info = statusOf(c.kind === "renamed" ? c.from : c.path);
    const apiSet = info.apiSet ?? null;
    if (info.status !== "ga") {
      return { ...c, apiStatus: info.status, apiSet, severity: "low", gaOnPlatform: null, platformNote: null };
    }
    return { ...c, apiStatus: info.status, apiSet, ...platformSeverity({ severity: c.severity, apiSet }, platform) };
  });
}

export function postProcess(changes, statusOf, platform) {
  return classifyChanges(detectRenames(changes), statusOf, platform);
}

/** One rollout's `apiDiffNote`: the diff's own note and the distinct platform notes of its changes. */
export function rolloutNote(note, changes) {
  const parts = [note, ...new Set(changes.map((c) => c.platformNote).filter(Boolean))].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}
