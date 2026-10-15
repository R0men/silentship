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

/** What a rollout group changes, in words. */
export function groupTitle(g) {
  if (g.toBuild) return g.toBuild;
  return g.removal ? "Files removed" : "Unversioned change";
}
