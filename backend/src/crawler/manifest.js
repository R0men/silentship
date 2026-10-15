export const LOADER_PATH = "office.js";

/** Dependencies the loader pulls in that are not derivable from the version map. */
const STATIC_DEPENDENCIES = ["microsoftajax.js"];

/**
 * "16.00".."16.02" -> ["16.00", "16.01", "16.02"].
 * The map value is a ceiling: older hosts request lower versions and the loader serves those as-is.
 */
export function versionsUpTo(min, max) {
  const [minMajor, minMinor] = min.split(".").map(Number);
  const [maxMajor, maxMinor] = max.split(".").map(Number);
  if ([minMajor, minMinor, maxMajor, maxMinor].some((n) => n === undefined || Number.isNaN(n))) return [max];
  if (minMajor !== maxMajor || minMinor > maxMinor) return [max];
  const width = max.split(".")[1].length;
  const out = [];
  for (let minor = minMinor; minor <= maxMinor; minor++) out.push(`${maxMajor}.${String(minor).padStart(width, "0")}`);
  return out;
}

export function hostFileName(hostType, platform, version, suffix) {
  return [hostType, platform, version, suffix].filter(Boolean).join("-").toLowerCase() + ".js";
}

export function buildManifest(info, locales) {
  const entries = new Map();
  const add = (entry) => {
    if (!entries.has(entry.path)) entries.set(entry.path, entry);
  };

  add({ path: LOADER_PATH, role: "loader" });

  for (const [hostType, platforms] of Object.entries(info.hostMap)) {
    for (const [platform, maxVersion] of Object.entries(platforms)) {
      for (const version of versionsUpTo(info.defaultFileVersion, maxVersion)) {
        add({ path: hostFileName(hostType, platform, version), role: "host", hostType, hostPlatform: platform });
      }
    }
  }

  const strings = info.constants.OfficeStringJS ?? "office_strings.js";
  for (const locale of locales) add({ path: `${locale}/${strings}`.toLowerCase(), role: "strings" });

  add({ path: (info.constants.O15InitHelper ?? "o15apptofilemappingtable.js").toLowerCase(), role: "mapping" });

  for (const ref of [...info.scriptRefs, ...STATIC_DEPENDENCIES]) {
    add({ path: ref.toLowerCase(), role: "dependency" });
  }

  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/** "excel-win32-16.01.js" -> "excel"; undefined for files that are not host files. */
export function hostTypeOf(path) {
  return /^([a-z]+)-[a-z0-9]+-\d+\.\d+\.js$/.exec(path)?.[1];
}
