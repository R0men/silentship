import { createHash } from "node:crypto";
import https from "node:https";
import zlib from "node:zlib";

/**
 * Akamai-Request-BC: "[a=184.84.216.155,b=93532222,c=g,n=DE_HE_FRANKFURT,o=20940]".
 * a = edge IP, n = edge location.
 */
export function parseAkamaiRequestBc(header) {
  if (!header) return { ip: null, location: null };
  const fields = new Map();
  for (const part of header.replace(/^\[|\]$/g, "").split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return { ip: fields.get("a") ?? null, location: fields.get("n") ?? null };
}

export function extractMeta(status, headers) {
  const akamai = parseAkamaiRequestBc(headers.get("akamai-request-bc"));
  const age = headers.get("age");
  return {
    httpStatus: status,
    lastModified: headers.get("last-modified"),
    etag: headers.get("etag"),
    age: age !== null && /^\d+$/.test(age) ? Number(age) : null,
    cacheStatus: headers.get("akamai-cache-status") ?? headers.get("x-cache"),
    cdnProvider: headers.get("x-cdn-provider"),
    edgeIp: akamai.ip,
    edgeLocation: akamai.location,
    requestId: headers.get("x-ms-request-id"),
  };
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * One GET on a fresh TCP/TLS connection (`agent: false`). Keep-alive would pin every sample to the same
 * edge server; a new connection lets the CDN balance us onto different ones, which is what sampling needs.
 * Resolves with status, headers, decoded body and the number of bytes on the wire.
 */
function getOnce(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, agent: false, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"];
        try {
          const body =
            encoding === "gzip"
              ? zlib.gunzipSync(raw)
              : encoding === "br"
                ? zlib.brotliDecompressSync(raw)
                : encoding === "deflate"
                  ? zlib.inflateSync(raw)
                  : raw;
          resolve({ status: res.statusCode, headers: res.headers, body, wireBytes: raw.length });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

function toHeaders(nodeHeaders) {
  const h = new Headers();
  for (const [k, v] of Object.entries(nodeHeaders)) {
    if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  return h;
}

export async function fetchFile(url, conditional = {}, { retries = 3, timeoutMs = 30_000 } = {}) {
  const headers = {
    "user-agent": "silentship/0.1 (+https://silentship.dev)",
    "accept-encoding": "gzip, br",
  };
  if (conditional.etag) headers["if-none-match"] = conditional.etag;
  if (conditional.lastModified) headers["if-modified-since"] = conditional.lastModified;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    try {
      const res = await getOnce(url, headers, timeoutMs);
      if (RETRYABLE.has(res.status) && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      const meta = { ...extractMeta(res.status, toHeaders(res.headers)), wireBytes: res.wireBytes };
      if (res.status === 304) return { ...meta, url, body: null, sha256: null, notModified: true };
      if (res.status < 200 || res.status >= 300) return { ...meta, url, body: null, sha256: null, notModified: false };
      return { ...meta, url, body: res.body, sha256: sha256(res.body), notModified: false };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Failed to fetch ${url}: ${String(lastError)}`);
}

/** Runs tasks with bounded concurrency, preserving input order in the result. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
