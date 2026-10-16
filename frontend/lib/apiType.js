// Wording for /reference pages: one API type's changes as titles, sentences and advice; and their URLs.
import { fmtDate, groupTitle } from "./format";

export const CHANNEL_NAME = { prod: "production", beta: "beta" };

/** `/reference/Excel.Range`, optionally with a member anchor: `/reference/Excel.Range#getCell`. */
export function typeHref(type, path) {
  const member = path && path !== type && path.startsWith(`${type}.`) ? `#${path.slice(type.length + 1)}` : "";
  return `/reference/${encodeURIComponent(type)}${member}`;
}

export const rolloutHref = (e) => `/rollouts/${e.channel}/${encodeURIComponent(e.group)}`;

const PLATFORM = { web: "web", win32: "Windows", winrt: "Windows (WinRT)", mac: "Mac", ios: "iOS", android: "Android" };
const HOST = { excel: "Excel", word: "Word", powerpoint: "PowerPoint", onenote: "OneNote", visio: "Visio", outlook: "Outlook" };

/** "excel-win32-16.01.js" → "Excel on Windows"; the loader and unknown names stay as they are. */
export function fileLabel(file) {
  const m = /^([a-z]+)-([a-z0-9]+)-\d/.exec(file);
  if (!m || !HOST[m[1]]) return file === "office.js" ? "all hosts (loader)" : file;
  return `${HOST[m[1]]} on ${PLATFORM[m[2]] ?? m[2]}`;
}

/** "Excel on web, Windows and Mac" for one host, a plain list across hosts. */
export function hostsSentence(files) {
  const labels = [...new Set(files.map(fileLabel))];
  const byHost = new Map();
  for (const l of labels) {
    const [host, platform] = l.includes(" on ") ? l.split(" on ") : [l, null];
    if (!byHost.has(host)) byHost.set(host, []);
    if (platform) byHost.get(host).push(platform);
  }
  return list([...byHost].map(([host, ps]) => (ps.length ? `${host} on ${list(ps)}` : host)));
}

function list(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const member = (e, type) => (e.path === type ? null : e.path.startsWith(`${type}.`) ? e.path.slice(type.length + 1) : e.path);

/** What happened, as a verb phrase about the type ("removed", "getCell removed", "renamed to …"). */
export function changePhrase(e, type) {
  const m = member(e, type);
  const subj = (s) => (m ? `${m} ${s}` : s);
  switch (e.kind) {
    case "removed":
      return subj("removed");
    case "added":
      return subj("added");
    case "renamed":
      if (e.from === type) return `renamed to ${e.path}`;
      if (e.path === type) return `renamed from ${e.from}`;
      return `${m} renamed from ${e.from?.split(".").pop()}`;
    case "enumChanged":
      return subj(`values changed${e.detail ? ` (${e.detail})` : ""}`);
    case "arityChanged":
      return subj(`parameters changed${e.detail ? ` (${e.detail.replace(/^params /, "")})` : ""}`);
    case "bodyChanged":
      return subj("implementation changed");
    case "kindChanged":
      return subj(`shape changed${e.detail ? ` (${e.detail})` : ""}`);
    default:
      return subj(e.kind);
  }
}

// Which change names a page when one build has several for the same API: the most telling first.
const KIND_WEIGHT = { renamed: 6, removed: 5, kindChanged: 4, arityChanged: 3, enumChanged: 2, bodyChanged: 1, added: 0 };

/**
 * The change that names the page: from the newest build that stuck in production, else in beta, else the
 * newest; within that build a rename beats a removal beats an addition (the old name is what people search).
 */
export function headlineEvent(events) {
  const live = events.filter((e) => e.status !== "abandoned");
  const first = live.find((e) => e.channel === "prod") ?? live.find((e) => e.channel === "beta") ?? events[0];
  return events
    .filter((e) => e.channel === first.channel && e.group === first.group && e.status === first.status)
    .sort((a, b) => (KIND_WEIGHT[b.kind] ?? 0) - (KIND_WEIGHT[a.kind] ?? 0))[0];
}

/** Channels where this exact change (path and kind) is live. */
function channelsOf(events, e) {
  const chans = new Set(
    events.filter((x) => x.path === e.path && x.kind === e.kind && x.status !== "abandoned").map((x) => x.channel),
  );
  return ["prod", "beta"].filter((c) => chans.has(c));
}

/** What a change is about on this page: a rename away from the type is about the type itself. */
const subjectOf = (e, type) => (e.kind === "renamed" && e.fromType === type ? e.from : e.path);

/** "ExcelApi BETA (PREVIEW ONLY)" → "ExcelApi BETA". */
const shortSet = (set) => set?.replace(/\s*\(PREVIEW ONLY\)/i, "") ?? null;

/** Next to the name: "Preview · ExcelApi BETA", "GA · ExcelApi 1.17", "Undocumented". */
export function statusLabel(docs) {
  if (docs?.status === "ga") return docs.apiSet ? `GA · ${shortSet(docs.apiSet)}` : "GA";
  if (docs?.status === "preview") return docs.apiSet ? `Preview · ${shortSet(docs.apiSet)}` : "Preview";
  return "Undocumented";
}

const TITLE_STATUS = { preview: " (preview API)", undocumented: " (undocumented API)" };

export function pageTitle(t) {
  const subjects = new Set(t.events.map((e) => subjectOf(e, t.type)));
  const status = TITLE_STATUS[t.docs?.status] ?? "";
  if (subjects.size > 1) return `${t.type}: ${subjects.size} API changes in Office.js${status}`;
  const e = headlineEvent(t.events);
  const chans = channelsOf(t.events, e).map((c) => CHANNEL_NAME[c]);
  const where = chans.length ? ` in Office.js ${list(chans)}` : " in Office.js (pulled back)";
  const own = e.path === t.type || e.kind === "renamed";
  return `${own ? t.type : e.path} ${changePhrase(e, own ? t.type : e.path)}${where}${status}`;
}

/** One sentence per channel: its newest change of this type and where that rollout stands. */
export function channelState(t, channel) {
  const e = t.events.find((x) => x.channel === channel);
  if (!e) return `No change seen on the ${CHANNEL_NAME[channel]} CDN.`;
  const build = groupTitle(e);
  const state =
    e.status === "complete"
      ? `rollout complete${e.completedAt ? ` ${fmtDate(e.completedAt)}` : ""}`
      : e.status === "abandoned"
        ? "pulled back — the CDN serves the previous version again"
        : `rolling out, on ${Math.round(e.share * 100)}% of sampled edges`;
  return `${changePhrase(e, t.type)} in ${build}, first seen ${fmtDate(e.firstSeenAt)}; ${state}.`;
}

const STATUS_WORDS = {
  ga: (d) => `a generally available API${d.apiSet ? ` (${d.apiSet})` : ""}`,
  preview: (d) => `a preview API${d.apiSet ? ` (${shortSet(d.apiSet)})` : ""}`,
  undocumented: () => "not in Microsoft's documentation",
};

/** Meta description; `lede` drops the closing sentence meant for search results. */
export function pageDescription(t, { lede = false } = {}) {
  const e = headlineEvent(t.events);
  const files = [...new Set(t.events.flatMap((x) => [...x.files, ...x.pulledFiles]))];
  const prod = t.events.some((x) => x.channel === "prod");
  const status = STATUS_WORDS[t.docs?.status]?.(t.docs);
  return [
    `${t.type}${status ? `, ${status},` : ""} ${changePhrase(e, t.type)} on the Office.js ${CHANNEL_NAME[e.channel]} CDN in ${groupTitle(e)}, first seen ${fmtDate(e.firstSeenAt)}.`,
    files.length ? `Affects ${hostsSentence(files)}.` : "",
    prod ? "" : "Not changed in production so far.",
    lede ? "" : "Full change history across Office.js builds.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** `isSetSupported("ExcelApi", "1.17")` for a released set, null otherwise. */
function setCheck(apiSet) {
  const m = /^(\w+Api)\s+(\d+\.\d+)$/.exec(apiSet ?? "");
  return m ? `Office.context.requirements.isSetSupported("${m[1]}", "${m[2]}")` : null;
}

/** Practical consequences for add-in code: the headline change, then what the API's status means. */
export function advice(t) {
  const e = headlineEvent(t.events);
  const name = e.kind === "renamed" ? (e.from ?? t.type) : e.path;
  const status = t.docs?.status ?? "undocumented";
  const out = [];
  switch (e.kind) {
    case "removed":
    case "renamed":
      out.push(
        `On clients that load the new build, \`${name}\` is \`undefined\`: calling or constructing it throws a TypeError (the messages are below).`,
      );
      if (e.kind === "renamed") {
        out.push(`Use \`${e.path}\`, with a fallback to the old name for clients still on the previous build.`);
      }
      break;
    case "added":
      out.push(`\`${name}\` appeared on the CDN.`);
      break;
    case "enumChanged":
      out.push(
        "Removed or changed values break comparisons and `switch` statements that use them; added values can show up in data your add-in reads.",
      );
      break;
    case "arityChanged":
      out.push("The function now declares a different number of parameters; check calls that rely on the old signature.");
      break;
    case "bodyChanged":
      out.push("Same name and signature, different implementation: behaviour can differ even though the API surface did not change.");
      break;
    case "kindChanged":
      out.push("The member changed shape (for example a function became a property or an object); code that calls or reads it the old way breaks.");
      break;
  }

  const check = `if (${name.split(".").slice(0, 2).join(".")}) { … }`;
  if (status === "preview") {
    out.push(
      `This is a preview API${t.docs.apiSet ? ` (${shortSet(t.docs.apiSet)})` : ""}: Microsoft says not to use it in production, and it can change or disappear in any build. If you use it anyway, check that it exists before every use — \`${check}\`. A requirement-set check does not help: preview APIs belong to no released set.`,
    );
  } else if (status === "undocumented") {
    out.push(
      `It is not in Microsoft's documentation (neither @types/office-js nor @types/office-js-preview): an internal API that can change in any build. Do not depend on it; if you must, check that it exists before use — \`${check}\`.`,
    );
  } else if (e.kind === "removed" || e.kind === "renamed") {
    out.push(
      `It is a generally available API${t.docs.apiSet ? ` (${t.docs.apiSet})` : ""}, so its requirement-set check still passes after this change${setCheck(t.docs.apiSet) ? ` — \`${setCheck(t.docs.apiSet)}\` returns true` : ""}. Check the API itself before use — \`${check}\` — and report the removal to Microsoft (OfficeDev/office-js on GitHub).`,
    );
  } else if (e.kind === "added" && setCheck(t.docs?.apiSet)) {
    out.push(`It is documented in ${t.docs.apiSet}; gate its use on \`${setCheck(t.docs.apiSet)}\`.`);
  }

  if (!t.events.some((x) => x.channel === "prod" && x.status !== "abandoned")) {
    out.push(
      "So far this is only on the beta CDN (`/lib/beta/hosted/`). Add-ins that load production Office.js (`/lib/1/hosted/`) are not affected yet; production builds often follow beta.",
    );
  }
  return out;
}

const WEBKIT = /-(mac|ios)-/;

/**
 * The TypeErrors code that still uses a removed or renamed API gets — the strings people paste into a
 * search box. Chromium (Windows, Android, the web) and, when Mac or iOS files changed, Safari's WebKit.
 * `<…>` marks the part that comes from the add-in's own code.
 */
export function errorMessages(t) {
  const e = headlineEvent(t.events);
  if (e.kind !== "removed" && e.kind !== "renamed") return [];
  const name = e.kind === "renamed" ? e.from : e.path;
  const leaf = name.split(".").pop();
  const isMember = name.split(".").length > 2 && /^[a-z]/.test(leaf);
  const files = [...e.files, ...e.pulledFiles];
  const out = [];
  if (e.detail === "enum" || e.detail === "namespace") {
    out.push({ engine: "Chromium", text: "TypeError: Cannot read properties of undefined (reading '<value>')" });
    if (files.some((f) => WEBKIT.test(f))) {
      out.push({ engine: "Safari", text: `TypeError: undefined is not an object (evaluating '${name}.<value>')` });
    }
  } else if (isMember) {
    out.push({ engine: "Chromium", text: `TypeError: <object>.${leaf} is not a function` });
    if (files.some((f) => WEBKIT.test(f))) {
      out.push({
        engine: "Safari",
        text: `TypeError: <object>.${leaf} is not a function. (In '<object>.${leaf}(…)', '<object>.${leaf}' is undefined)`,
      });
    }
  } else {
    out.push(
      { engine: "Chromium", text: `TypeError: ${name} is not a constructor` },
      { engine: "Chromium", text: `TypeError: ${name} is not a function` },
      { engine: "Chromium", text: "TypeError: Right-hand side of 'instanceof' is not callable" },
      { engine: "Chromium", text: "TypeError: Cannot read properties of undefined (reading '<member>')" },
    );
    if (files.some((f) => WEBKIT.test(f))) {
      out.push(
        { engine: "Safari", text: `TypeError: undefined is not a constructor (evaluating 'new ${name}(…)')` },
        { engine: "Safari", text: `TypeError: undefined is not an object (evaluating '${name}.<member>')` },
      );
    }
  }
  return out;
}
