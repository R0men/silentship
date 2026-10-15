export const SEVERITY_RANK = { low: 0, medium: 1, high: 2 };

export function maxSeverity(values, fallback = "low") {
  let best = fallback;
  for (const v of values) if (SEVERITY_RANK[v] > SEVERITY_RANK[best]) best = v;
  return best;
}

function enumDelta(a, b) {
  const removed = [];
  const changed = [];
  const added = [];
  for (const key of Object.keys(a)) {
    if (!(key in b)) removed.push(key);
    else if (a[key] !== b[key]) changed.push(key);
  }
  for (const key of Object.keys(b)) if (!(key in a)) added.push(key);
  return { removed, changed, added };
}

const callable = (n) => n.kind === "class" || n.kind === "function";

/**
 * Arity and body of callables. Two cases carry no signal and are not reported as signature/body changes:
 *  - generated wrappers (`generic`): length is 0 and the body is shared, whatever the real signature;
 *  - class constructors: add-ins never call `new Excel.Range(...)`, and a switch to metadata-built
 *    classes changes every constructor at once. Their changes are reported as low.
 */
function compareCallables(path, a, b) {
  if (a.generic || b.generic) {
    return a.kind === b.kind ? null : { path, kind: "kindChanged", severity: "low", before: a, after: b };
  }
  const isClass = a.kind === "class" || b.kind === "class";
  if (a.arity !== b.arity)
    return { path, kind: "arityChanged", severity: isClass ? "low" : "high", before: a, after: b };
  if (a.kind !== b.kind)
    return { path, kind: "kindChanged", severity: isClass ? "low" : "medium", before: a, after: b };
  if (a.bodyHash !== b.bodyHash)
    return { path, kind: "bodyChanged", severity: isClass ? "low" : "medium", before: a, after: b };
  return null;
}

function compareNodes(path, a, b) {
  if (callable(a) && callable(b)) return compareCallables(path, a, b);
  if (a.kind !== b.kind) return { path, kind: "kindChanged", severity: "high", before: a, after: b };
  switch (a.kind) {
    case "enum": {
      const detail = enumDelta(a.values, b.values);
      if (!detail.removed.length && !detail.changed.length && !detail.added.length) return null;
      const breaking = detail.removed.length > 0 || detail.changed.length > 0;
      return { path, kind: "enumChanged", severity: breaking ? "high" : "low", before: a, after: b, detail };
    }
    case "property": {
      const bb = b;
      if (a.get === bb.get && a.set === bb.set) return null;
      // Losing a getter or setter breaks reads/writes; gaining one does not.
      const lost = (a.get && !bb.get) || (a.set && !bb.set);
      return { path, kind: "kindChanged", severity: lost ? "high" : "low", before: a, after: b };
    }
    case "value":
      return a.type === b.type ? null : { path, kind: "kindChanged", severity: "medium", before: a, after: b };
    case "ref":
      // Aliases depend on traversal order; not meaningful on their own.
      return null;
    case "namespace":
      return null;
  }
}

/**
 * Structural diff of two surfaces. Removals under an already-removed parent are folded into the parent
 * so a vanished class shows up as one change rather than hundreds.
 */
export function diffSurfaces(before, after) {
  const changes = [];
  const removedRoots = [];
  const addedRoots = [];
  const under = (path, roots) => roots.some((r) => path.startsWith(r + "."));

  for (const path of Object.keys(before).sort()) {
    const a = before[path];
    const b = after[path];
    if (b === undefined) {
      if (a.kind === "ref" || under(path, removedRoots)) continue;
      removedRoots.push(path);
      changes.push({ path, kind: "removed", severity: "high", before: a, after: null });
      continue;
    }
    const change = compareNodes(path, a, b);
    if (change) changes.push(change);
  }
  for (const path of Object.keys(after).sort()) {
    if (path in before) continue;
    const b = after[path];
    if (b.kind === "ref" || under(path, addedRoots)) continue;
    addedRoots.push(path);
    changes.push({ path, kind: "added", severity: "low", before: null, after: b });
  }
  return changes.sort((x, y) => SEVERITY_RANK[y.severity] - SEVERITY_RANK[x.severity] || x.path.localeCompare(y.path));
}

/** A surface that lost more than this share of its paths without an error is treated as truncated. */
export const SHRINK_LIMIT = 0.4;

/** Error text without the file names (blob shas differ between versions even for the same failure). */
const errorSignature = (error) => (error ? error.replace(/\b[a-f0-9]{64}(@[a-f0-9]+)?(\.js)?: /g, "").trim() : null);

/**
 * Diff two reflections ({ surface, error }) without trusting a reflection that may be incomplete.
 * If the new side failed differently from the old one, or shrank by more than SHRINK_LIMIT without any
 * error, a missing member says more about our sandbox than about Microsoft: drop "removed". Symmetrically,
 * an incomplete old side would make everything look "added". The caller shows `note` instead.
 */
export function diffReflections(before, after) {
  let changes = diffSurfaces(before.surface, after.surface);
  const notes = [];
  const sizeBefore = Object.keys(before.surface).length;
  const sizeAfter = Object.keys(after.surface).length;
  const sameFailure = errorSignature(before.error) === errorSignature(after.error);

  const afterIncomplete = (after.error && !sameFailure) || sizeAfter < sizeBefore * (1 - SHRINK_LIMIT);
  const beforeIncomplete = (before.error && !sameFailure) || sizeBefore < sizeAfter * (1 - SHRINK_LIMIT);
  if (afterIncomplete) {
    changes = changes.filter((c) => c.kind !== "removed");
    notes.push(
      after.error && !sameFailure
        ? `new version could not be fully reflected (${errorSignature(after.error).slice(0, 160)}); removals not reported`
        : `API surface shrank from ${sizeBefore} to ${sizeAfter} members without an error; removals not reported`,
    );
  }
  if (beforeIncomplete) {
    changes = changes.filter((c) => c.kind !== "added");
    notes.push(
      before.error && !sameFailure
        ? `previous version could not be fully reflected; additions not reported`
        : `API surface grew from ${sizeBefore} to ${sizeAfter} members; additions not reported`,
    );
  }
  return { changes, note: notes.length ? notes.join("; ") : null };
}
