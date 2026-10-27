export function timeAgo(date) {
  if (!date) return "never";
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const units = [
    [60, "min"],
    [24, "h"],
    [30, "d"],
    [12, "mo"],
  ];
  let n = s / 60;
  for (const [size, label] of units) {
    if (n < size) return `${Math.floor(n)} ${label} ago`;
    n /= size;
  }
  return `${Math.floor(n)} y ago`;
}

export function fmtDate(date) {
  return new Date(date).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export const KIND_LABEL = {
  removed: "Removed",
  added: "Added",
  arityChanged: "Signature",
  enumChanged: "Enum values",
  bodyChanged: "Implementation",
  kindChanged: "Shape",
  renamed: "Renamed",
};

/** Short label for where an API stands in Microsoft's docs. */
export function apiStatusLabel(c) {
  if (c.apiStatus === "preview") return "preview API";
  if (c.apiStatus === "undocumented") return "undocumented";
  return c.apiSet ?? null;
}

/** "excel-win32-16.01.js" -> "excel-win32 16.01" */
export const hostLabel = (file) => file.replace(/\.js$/, "").replace(/-(\d+\.\d+)$/, " $1");

export const pct = (share) => `${Math.round((share ?? 0) * 100)}%`;

export const STATUS_LABEL = { rolling: "Rolling out", complete: "Complete", abandoned: "Pulled back" };

/**
 * Tracks the site shows: production and beta. Each is served by two endpoints with byte-identical host
 * files — the legacy appsforoffice.microsoft.com and Microsoft's recommended OneCDN — shown side by side.
 */
export const CHANNELS = {
  prod: { label: "Production", where: "/lib/1/hosted" },
  beta: { label: "Beta", where: "/lib/beta/hosted" },
};

export const ENDPOINTS = {
  legacy: { label: "legacy", host: "appsforoffice.microsoft.com" },
  onecdn: { label: "onecdn", host: "officeapis.public.onecdn.static.microsoft" },
};

/**
 * Why a release's endpoints differ, in a few words; null when they agree. Only files both endpoints serve
 * on this build are compared: one still on an older build is `notYetOn`, not a difference.
 */
export function divergence(r) {
  if (!r.diverged) return null;
  // The flags first: on legacy they stop loading MicrosoftAjax, whatever else differs.
  if (r.flagsChanged) return "loader flags changed";
  if (r.differentFiles?.length) return r.differentFiles.length === 1 ? "1 file differs" : `${r.differentFiles.length} files differ`;
  return "endpoints differ";
}

/** "not yet on onecdn" while one endpoint still serves some files of the release on an older build. */
export function notYetOn(r) {
  if (!r.onecdnCrawled) return null;
  const late = Object.keys(ENDPOINTS).filter((e) => !r.endpoints?.[e] || r.notYetOn?.[e]?.length);
  return late.length === 1 ? `not yet on ${ENDPOINTS[late[0]].label}` : null;
}

export const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "5 API changes in 19 files": unique changes lead, the files that carry them come second. */
export function apiChangesText(g) {
  if (!g.uniqueApiChanges) return "No public API changes";
  return `${plural(g.uniqueApiChanges, "API change")} in ${plural(g.apiChangeFiles, "file")}`;
}

export const channelLabel = (channel) => CHANNELS[channel]?.label ?? channel;

/** "16.0.20606.15070" -> "16.0.20606": enough to name a release in a headline; the full stamp is on its page. */
export const shortBuild = (b) => b?.split(".").slice(0, 3).join(".") ?? b;

/** What a release does to the API, in a few words for the home headline ("…: 1% of sampled edges, <this>."). */
export function severityPhrase(g) {
  // High without API changes: a removed file or new loader security defaults.
  if (g.severity === "high" || g.severity === "medium") {
    return g.uniqueApiChanges ? `${g.severity}-severity API changes` : `${g.severity} severity`;
  }
  return g.uniqueApiChanges ? "no breaking API changes" : "no public API changes";
}

const KIND_PHRASE = {
  removed: "removed",
  added: "added",
  renamed: "renamed",
  arityChanged: "with new parameters",
  kindChanged: "with a new shape",
  enumChanged: "with changed enum values",
  bodyChanged: "with a changed implementation",
};

/** Up to `limit` of the most important high-severity changes, per type and kind: "Word.LineFormat: 8 members removed". */
export function highlights(apiChanges, limit = 3) {
  const by = new Map();
  for (const c of apiChanges ?? []) {
    if (c.severity !== "high") continue;
    const key = `${c.type}\u0000${c.kind}`;
    by.set(key, { type: c.type, kind: c.kind, n: (by.get(key)?.n ?? 0) + 1 });
  }
  return [...by.values()]
    .sort((a, b) => b.n - a.n || a.type.localeCompare(b.type))
    .slice(0, limit)
    .map((h) => `${h.type}: ${h.n === 1 ? "1 member" : `${h.n} members`} ${KIND_PHRASE[h.kind] ?? h.kind}`);
}

/**
 * The 1–2 sentences on top of a release page, from its data: what rolls out where and since when, and what
 * it does to the documented API. `lead` and `verdict` are plain text; `highlights` for High only.
 */
export function releaseSummary(r) {
  const share = r.status === "complete" ? 1 : r.share;
  const where = `the ${channelLabel(r.channel).toLowerCase()} CDN`;
  const verb = r.status === "complete" ? "rolled out to" : r.status === "abandoned" ? "was pulled back from" : "is rolling out to";
  const what = r.toBuild ? `Office.js build ${r.toBuild}` : r.removal ? "A removal of Office.js files" : "An unversioned Office.js change";
  const lead = `${what} ${verb} ${where} (first seen ${fmtDate(r.firstSeenAt)}, ${pct(share)} of sampled edges).`;
  const changes = r.apiChanges ?? [];
  let verdict;
  if (!r.uniqueApiChanges) {
    verdict =
      r.severity === "high"
        ? "No public API changes, but high severity: a file was removed or office.js changed its security defaults."
        : "No public API changes. This build doesn't change any documented API.";
  } else if (r.severity === "high" || r.severity === "medium") {
    verdict = `Documented API changed: ${plural(r.uniqueApiChanges, "change")}. See the list below.`;
  } else if (changes.length && changes.every((c) => c.apiStatus === "preview" || c.apiStatus === "undocumented")) {
    verdict = "Only preview or undocumented APIs changed.";
  } else {
    verdict = `No breaking changes to documented APIs: ${plural(r.uniqueApiChanges, "addition or minor change")}, listed below.`;
  }
  return { lead, verdict, highlights: r.severity === "high" ? highlights(changes) : [] };
}

/** What a rollout group changes, in words. */
export function groupTitle(g) {
  if (g.toBuild) return g.toBuild;
  return g.removal ? "Files removed" : "Unversioned change";
}
