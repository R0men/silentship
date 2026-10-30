import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One .env at the repository root is shared with the backend.
const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Resolved when the server starts (not inlined at build), so one build works against any backend.
process.env.API_URL = (process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || 4000}`).replace(/\/$/, "");
const API_URL = process.env.API_URL;

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Lets a second build (e.g. a test instance) live next to the running one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // One page per track: a build on the OneCDN endpoint is shown on the production or beta page.
  async redirects() {
    return [{ source: "/rollouts/onecdn-:track(prod|beta)/:group", destination: "/rollouts/:track/:group", statusCode: 301 }];
  },
  // Legal boilerplate is kept out of search results by a header too, not only by the page's robots meta.
  async headers() {
    return [{ source: "/privacy", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] }];
  },
  // The browser only ever talks to this origin; Next forwards API calls to the backend.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/rss.xml", destination: `${API_URL}/rss.xml` },
      { source: "/confirm", destination: `${API_URL}/confirm` },
      { source: "/unsubscribe", destination: `${API_URL}/unsubscribe` },
      // For uptime monitors: 503 when the crawler is behind.
      { source: "/health", destination: `${API_URL}/health` },
    ];
  },
};

export default nextConfig;
