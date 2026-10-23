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

/** What a rollout group changes, in words. */
export function groupTitle(g) {
  if (g.toBuild) return g.toBuild;
  return g.removal ? "Files removed" : "Unversioned change";
}
