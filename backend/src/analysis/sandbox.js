import vm from "node:vm";

const noop = () => {};

/**
 * A callable, constructible object where every property is another stub.
 * Lets browser-oriented code run past DOM access without a real DOM.
 */
export function deepStub(registry, overrides = {}) {
  const cache = new Map(Object.entries(overrides));
  const target = function stub() {};
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === "toString" || prop === "valueOf") return () => "";
      if (prop === "then") return undefined; // never look like a Promise
      if (prop === "length") return 0;
      if (typeof prop === "symbol") return undefined;
      if (!cache.has(prop)) cache.set(prop, deepStub(registry));
      return cache.get(prop);
    },
    set(_t, prop, value) {
      cache.set(prop, value);
      return true;
    },
    has: () => true,
    apply: () => deepStub(registry),
    construct: () => deepStub(registry),
  });
  registry.add(proxy);
  return proxy;
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Browser globals that host files touch at load time; real ones are not needed for reflection. */
const STUBBED_GLOBALS = [
  "HTMLElement",
  "HTMLScriptElement",
  "HTMLIFrameElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MessageEvent",
  "MutationObserver",
  "XMLHttpRequest",
  "Image",
  "Blob",
  "FormData",
  "MessageChannel",
  "Worker",
  "DOMParser",
];

/** Where the loader believes it was loaded from; it refuses to initialize without a matching <script>. */
const LOADER_SRC = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

export function createSandbox(extraStubs = []) {
  const stubs = new WeakSet();
  const location = {
    href: "https://localhost/taskpane.html",
    protocol: "https:",
    host: "localhost",
    hostname: "localhost",
    origin: "https://localhost",
    pathname: "/taskpane.html",
    search: "",
    hash: "",
    port: "",
    replace: noop,
    assign: noop,
    reload: noop,
  };
  const g = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop },
    // Timers never fire: we only want definitions, not initialization side effects.
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    requestAnimationFrame: () => 0,
    document: deepStub(stubs, {
      currentScript: { src: LOADER_SRC, getAttribute: () => null },
      readyState: "complete",
      cookie: "",
    }),
    navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", language: "en-US", languages: ["en-US"] },
    location,
    history: { replaceState: noop, pushState: noop },
    external: {},
    name: "",
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    addEventListener: noop,
    removeEventListener: noop,
    postMessage: noop,
    performance: { now: () => 0, mark: noop, measure: noop, getEntriesByName: () => [] },
    screen: { width: 1920, height: 1080 },
    crypto: { getRandomValues: (a) => a },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    TextEncoder,
    TextDecoder,
  };
  for (const name of [...STUBBED_GLOBALS, ...extraStubs]) g[name] = deepStub(stubs);
  g.URL = URL;
  g.URLSearchParams = URLSearchParams;
  g.window = g;
  g.self = g;
  g.top = g;
  g.parent = g;
  g.globalThis = g;
  const context = vm.createContext(g);
  stubs.add(context);
  return { context, stubs };
}

export function runInSandbox(sandbox, source, filename, timeoutMs = 15_000) {
  try {
    vm.runInContext(source, sandbox.context, { filename, timeout: timeoutMs });
    return { error: null };
  } catch (err) {
    // Partial execution still defines most namespaces; keep going and report.
    return { error: String(err instanceof Error ? err.message : err).slice(0, 500) };
  }
}
