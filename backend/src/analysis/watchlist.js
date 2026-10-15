/** Normalizes "Excel.Range.*", "Excel.Range" and "excel.range" to a comparable form. */
function normalize(pattern) {
  const trimmed = pattern.trim();
  const wildcard = trimmed.endsWith(".*") || trimmed.endsWith("*");
  const base = trimmed.replace(/\.?\*$/, "").toLowerCase();
  return { base, wildcard };
}

/**
 * A change affects a watched API when:
 *  - the path matches exactly;
 *  - the pattern is a wildcard and the change is inside it;
 *  - an ancestor of the watched path was removed or changed kind (e.g. the whole class is gone);
 *  - the change is to the DDA method-name registry entry for the watched method: common APIs such as
 *    Office.context.ui.displayDialogAsync hang off runtime objects we cannot reflect, but their names are
 *    registered in OSF.DDA.AsyncMethodNames / SyncMethodNames.
 */
export function matchesWatch(watch, change) {
  if (watch.hosts.length > 0 && change.hostType && !watch.hosts.includes(change.hostType)) return false;
  const { base, wildcard } = normalize(watch.pattern);
  if (!base) return false;
  const path = change.path.toLowerCase();
  if (path === base) return true;
  if (wildcard && path.startsWith(base + ".")) return true;
  if (base.startsWith(path + ".") && (change.kind === "removed" || change.kind === "kindChanged")) return true;
  const dda = DDA_ENTRY.exec(path);
  return dda !== null && base.split(".").pop() === dda[1];
}

const DDA_ENTRY = /^osf\.dda\.(?:async|sync)methodnames\.([^.]+)/;

export function matchingChanges(watches, changes) {
  if (watches.length === 0) return changes;
  return changes.filter((c) => watches.some((w) => matchesWatch(w, c)));
}
