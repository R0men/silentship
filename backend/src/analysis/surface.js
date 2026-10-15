import { normalizedSourceHash } from "./fn-hash.js";
import { createSandbox, deepStub, runInSandbox } from "./sandbox.js";

/** Flat map: dotted path -> node. Keys are sorted for stable JSON in the archive. */

export const DEFAULT_ROOTS = [
  "Office",
  "OfficeExtension",
  "OfficeCore",
  "Excel",
  "Word",
  "PowerPoint",
  "OneNote",
  "Visio",
  "Outlook",
  "OfficeRuntime",
];

/** Namespaces under OSF that hold public method names (e.g. displayDialogAsync). */
const OSF_PUBLIC = ["OSF.DDA.AsyncMethodNames", "OSF.DDA.SyncMethodNames", "OSF.DDA.EventDescriptors"];

const MAX_DEPTH = 8;
const SKIP_STATIC = new Set(["length", "name", "prototype", "arguments", "caller"]);

function isInternal(key) {
  return key.startsWith("_") || key.startsWith("$");
}

function fnHash(fn) {
  let src;
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    return "unavailable";
  }
  return normalizedSourceHash(src);
}

function isEnumLike(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    if (!desc || !("value" in desc)) return false;
    const t = typeof desc.value;
    if (t !== "string" && t !== "number") return false;
  }
  return true;
}

function ownKeys(obj) {
  try {
    return Object.getOwnPropertyNames(obj).filter((k) => !isInternal(k));
  } catch {
    return [];
  }
}

export function reflectSurface(sandbox, roots = DEFAULT_ROOTS) {
  const surface = {};
  const seen = new WeakMap();
  const global = sandbox.context;

  const visit = (path, value, depth) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      surface[path] = { kind: "value", type: value === null ? "null" : typeof value };
      return;
    }
    const obj = value;
    if (sandbox.stubs.has(obj)) return;
    const firstPath = seen.get(obj);
    if (firstPath !== undefined) {
      surface[path] = { kind: "ref", target: firstPath };
      return;
    }
    seen.set(obj, path);
    if (depth > MAX_DEPTH) {
      surface[path] = { kind: "value", type: typeof value };
      return;
    }

    if (typeof value === "function") {
      const fn = value;
      const proto = fn.prototype;
      const protoKeys = proto && typeof proto === "object" ? ownKeys(proto).filter((k) => k !== "constructor") : [];
      surface[path] = { kind: protoKeys.length > 0 ? "class" : "function", arity: fn.length, bodyHash: fnHash(fn) };

      for (const key of protoKeys) {
        const desc = Object.getOwnPropertyDescriptor(proto, key);
        const memberPath = `${path}.${key}`;
        if (desc.get || desc.set) {
          surface[memberPath] = { kind: "property", get: !!desc.get, set: !!desc.set };
        } else if (typeof desc.value === "function") {
          surface[memberPath] = { kind: "function", arity: desc.value.length, bodyHash: fnHash(desc.value) };
        } else {
          surface[memberPath] = { kind: "value", type: desc.value === null ? "null" : typeof desc.value };
        }
      }
      for (const key of ownKeys(fn)) {
        if (SKIP_STATIC.has(key) || protoKeys.includes(key)) continue;
        visitMember(path, fn, key, depth);
      }
      return;
    }

    if (Array.isArray(value)) {
      surface[path] = { kind: "value", type: "array" };
      return;
    }

    if (isEnumLike(obj)) {
      const values = {};
      for (const key of Object.keys(obj).sort()) values[key] = obj[key];
      surface[path] = { kind: "enum", values };
      return;
    }

    surface[path] = { kind: "namespace" };
    for (const key of ownKeys(obj)) visitMember(path, obj, key, depth);
  };

  const visitMember = (parentPath, owner, key, depth) => {
    const desc = Object.getOwnPropertyDescriptor(owner, key);
    if (!desc) return;
    const path = `${parentPath}.${key}`;
    // Never invoke getters: they may depend on host state or have side effects.
    if (desc.get || desc.set) {
      surface[path] = { kind: "property", get: !!desc.get, set: !!desc.set };
      return;
    }
    visit(path, desc.value, depth + 1);
  };

  for (const root of roots) {
    if (Object.prototype.hasOwnProperty.call(global, root)) visit(root, global[root], 0);
  }
  for (const dotted of OSF_PUBLIC) {
    let cur = global;
    for (const part of dotted.split(".")) cur = cur && typeof cur === "object" ? cur[part] : undefined;
    if (cur && typeof cur === "object") visit(dotted, cur, 0);
  }

  markGeneric(surface);
  const sorted = {};
  for (const key of Object.keys(surface).sort()) sorted[key] = surface[key];
  return sorted;
}

/** A body shared by at least this many members is a generated wrapper, not hand-written code. */
const GENERIC_MIN_SHARED = 5;

/**
 * Metadata-driven builds create every method from one wrapper (`function(){return invoke(meta, arguments)}`):
 * its `length` is 0 and its body is identical across hundreds of members, so arity and body say nothing
 * about the real signature. Flag those nodes so the diff compares only their presence.
 */
function markGeneric(surface) {
  const counts = new Map();
  for (const node of Object.values(surface)) {
    if (node.bodyHash) counts.set(node.bodyHash, (counts.get(node.bodyHash) ?? 0) + 1);
  }
  for (const node of Object.values(surface)) {
    if (node.bodyHash && counts.get(node.bodyHash) >= GENERIC_MIN_SHARED) node.generic = true;
  }
}

const MAX_STUB_RETRIES = 25;

/** Constructors that fill in their prototype from metadata on first instantiation. */
const LAZY_CLASS = /_typeInited|buildPrototype/;

/**
 * Newer Office.js builds (seen first in 16.0.20606) no longer define classes like Excel.Range up front.
 * Every class is a generic stub whose constructor calls buildPrototype(metadata) the first time an
 * instance is created; until then the prototype is empty and reflection would report every method as
 * removed. Instantiate each such stub once with dummy arguments so the real prototype exists.
 * Returns how many classes were materialized.
 */
export function materializeLazyClasses(sandbox, roots = DEFAULT_ROOTS) {
  const global = sandbox.context;
  let count = 0;
  for (const root of roots) {
    const ns = global[root];
    if (!ns || typeof ns !== "object") continue;
    for (const key of Object.getOwnPropertyNames(ns)) {
      const desc = Object.getOwnPropertyDescriptor(ns, key);
      const fn = desc && "value" in desc ? desc.value : undefined;
      if (typeof fn !== "function") continue;
      let src;
      try {
        src = Function.prototype.toString.call(fn);
      } catch {
        continue;
      }
      if (!LAZY_CLASS.test(src)) continue;
      try {
        new fn(deepStub(sandbox.stubs), deepStub(sandbox.stubs));
      } catch {
        // The base constructor may reject fake arguments; buildPrototype usually ran already.
      }
      count++;
    }
  }
  return count;
}

/**
 * Execute scripts in order (as the loader would) and reflect the resulting API.
 * When a script dies on an unknown browser global, stub that global and start over.
 */
export function extractSurface(sources, roots) {
  const extra = new Set();
  for (let attempt = 0; ; attempt++) {
    const sandbox = createSandbox(extra);
    const errors = [];
    let missing;
    for (const { filename, source } of sources) {
      const { error } = runInSandbox(sandbox, source, filename);
      if (!error) continue;
      errors.push(`${filename}: ${error}`);
      missing ??= /^(\w+) is not defined$/.exec(error)?.[1];
    }
    if (missing && !extra.has(missing) && attempt < MAX_STUB_RETRIES) {
      extra.add(missing);
      continue;
    }
    const materialized = materializeLazyClasses(sandbox, roots);
    return {
      surface: reflectSurface(sandbox, roots),
      error: errors.length ? errors.join("; ") : null,
      materialized,
    };
  }
}

/**
 * Host files expect the loader to have run first (they call into OSF._OfficeAppFactory etc.),
 * so execute loader + host together. Entries identical to what the loader defines on its own are
 * dropped: they belong to office.js's surface, and keeping them would repeat every loader change
 * once per host file.
 */
export function extractHostSurface(loader, host, roots) {
  const own = extractSurface([loader], roots).surface;
  const combined = extractSurface([loader, host], roots);
  const surface = {};
  for (const [path, node] of Object.entries(combined.surface)) {
    const fromLoader = own[path];
    if (fromLoader && JSON.stringify(fromLoader) === JSON.stringify(node)) continue;
    surface[path] = node;
  }
  // The loader's own init failure is expected outside a real host; only report host-file errors.
  const hostErrors = combined.error
    ?.split("; ")
    .filter((e) => !e.startsWith(`${loader.filename}:`))
    .join("; ");
  return { surface, error: hostErrors || null, materialized: combined.materialized };
}
