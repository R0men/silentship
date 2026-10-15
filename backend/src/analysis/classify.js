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

/** Attach API status and requirement set; demote everything that is not GA to low. */
export function classifyChanges(changes, statusOf = apiStatus) {
  return changes.map((c) => {
    // The side that existing add-ins depend on decides: the old name for removals and renames.
    const info = statusOf(c.kind === "renamed" ? c.from : c.path);
    const severity = info.status === "ga" ? c.severity : "low";
    return { ...c, apiStatus: info.status, apiSet: info.apiSet ?? null, severity };
  });
}

export function postProcess(changes, statusOf) {
  return classifyChanges(detectRenames(changes), statusOf);
}
