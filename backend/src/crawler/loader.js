import { createHash } from "node:crypto";
import { parse } from "@babel/parser";

import { walk } from "../util/ast.js";

/** Facts extracted statically from the office.js loader. */

/** Converts an object literal to plain data; non-literal values are skipped. */
function literalValue(node) {
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return node.value;
    case "NullLiteral":
      return null;
    case "UnaryExpression":
      // Minifiers emit !0 / !1 for booleans.
      if (node.operator === "!" && node.argument.type === "NumericLiteral") return !node.argument.value;
      return undefined;
    case "ObjectExpression":
      return objectValue(node);
    default:
      return undefined;
  }
}

function objectValue(node) {
  const out = {};
  for (const prop of node.properties) {
    if (prop.type !== "ObjectProperty" || prop.computed) continue;
    const key =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.type === "StringLiteral" ? prop.key.value : undefined;
    if (key === undefined) continue;
    const value = literalValue(prop.value);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** "OSF.ConstantNames" for a MemberExpression chain, otherwise undefined. */
function memberPath(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") {
    const base = memberPath(node.object);
    return base === undefined ? undefined : `${base}.${node.property.name}`;
  }
  return undefined;
}

const SCRIPT_REF = /^[a-z0-9_\-/]+\.js$/i;

export function parseLoader(source) {
  const ast = parse(source, { sourceType: "script", errorRecovery: true });
  const assignments = new Map();
  const scriptRefs = new Set();

  walk(ast.program, (node) => {
    if (node.type === "AssignmentExpression" && node.operator === "=" && node.right.type === "ObjectExpression") {
      const target = memberPath(node.left);
      if (target === "OSF.HostSpecificFileVersionMap" || target === "OSF.ConstantNames") {
        // The loader may assign ConstantNames more than once; merge so later keys win.
        assignments.set(target, { ...assignments.get(target), ...objectValue(node.right) });
      }
    } else if (node.type === "StringLiteral" && SCRIPT_REF.test(node.value) && node.value.includes("/")) {
      scriptRefs.add(node.value);
    }
  });

  const rawMap = assignments.get("OSF.HostSpecificFileVersionMap") ?? {};
  const hostMap = {};
  for (const [hostType, platforms] of Object.entries(rawMap)) {
    if (!platforms || typeof platforms !== "object") continue;
    for (const [platform, version] of Object.entries(platforms)) {
      if (typeof version !== "string") continue;
      (hostMap[hostType] ??= {})[platform] = version;
    }
  }

  const constants = {};
  for (const [key, value] of Object.entries(assignments.get("OSF.ConstantNames") ?? {})) {
    if (typeof value === "string") constants[key] = value;
  }

  // HostSpecificFileVersionDefault is assigned as a standalone member in current builds.
  const defaultMatch = /HostSpecificFileVersionDefault\s*=\s*"([\d.]+)"/.exec(source);

  return {
    build: constants.FileVersion ?? null,
    hostMap,
    defaultFileVersion: constants.HostSpecificFileVersionDefault ?? defaultMatch?.[1] ?? "16.00",
    constants,
    scriptRefs: [...scriptRefs].sort(),
  };
}

/**
 * Security-default flags the OneCDN office.js sets before the loader code:
 *   isOsfSecurityDefaultsEnabled = true;  → Trusted Types on (unless data-enable-trusted-types says otherwise)
 *   osfLoadMsAjax = false;                → MicrosoftAjax (Sys.*, Type.registerNamespace) is not loaded
 * Only a bare assignment of a literal counts: the loader itself reads the first flag and writes
 * `self.osfLoadMsAjax = b` from a variable, and a minifier may spell the literal `!0` / `!1`.
 */
const FLAG_RE = {
  securityDefaults: /(?<![\w$.])isOsfSecurityDefaultsEnabled\s*=\s*(true|false|!0|!1)\b/,
  loadMsAjax: /(?<![\w$.])osfLoadMsAjax\s*=\s*(true|false|!0|!1)\b/,
};
const FLAG_STATEMENTS = /(?<![\w$.])(?:isOsfSecurityDefaultsEnabled|osfLoadMsAjax)\s*=\s*(?:true|false|!0|!1)\b\s*;?\s*/g;
const flagValue = (literal) => literal === "true" || literal === "!0";

/** `{ securityDefaults, loadMsAjax }`: true / false, or null when the loader does not set the flag. */
export function loaderFlags(source) {
  const out = {};
  for (const [name, re] of Object.entries(FLAG_RE)) {
    const m = re.exec(source);
    out[name] = m ? flagValue(m[1]) : null;
  }
  return out;
}

export const sameFlags = (a, b) => a.securityDefaults === b.securityDefaults && a.loadMsAjax === b.loadMsAjax;

/**
 * sha256 of the loader without its flag assignments: equal for the legacy and the OneCDN office.js of one
 * build, so the two endpoints can be compared. Never a version id — that stays the sha256 of the bytes.
 */
export function bodyHashSansFlags(source) {
  return createHash("sha256").update(source.replace(FLAG_STATEMENTS, "")).digest("hex");
}

/** Microsoft's page on the CDN endpoints, including what the OneCDN security defaults change. */
export const MS_CDN_DOCS =
  "https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn";

const flagText = (v) => (v === null || v === undefined ? "unset" : String(v));

/** The loader-flags-changed sentence for alerts and the rollout page. */
export function flagsChangeNotice(channel, from, to) {
  return (
    `Office.js loader on ${channel} changed security defaults: ` +
    `isOsfSecurityDefaultsEnabled ${flagText(from?.securityDefaults)}→${flagText(to?.securityDefaults)}, ` +
    `osfLoadMsAjax ${flagText(from?.loadMsAjax)}→${flagText(to?.loadMsAjax)}. ` +
    `Add-ins relying on MicrosoftAjax (Sys.*, Type.registerNamespace) or on implicit command registration may break. ` +
    `See Microsoft's migration notes: ${MS_CDN_DOCS}`
  );
}
