import { apiGetOr } from "@/lib/api";
import { typeHref } from "@/lib/apiType";
import { groupTitle, KIND_LABEL, pct } from "@/lib/format";
import { SITE, SITE_URL } from "@/lib/site";

// Rendered per request like the sitemap: the list of rollouts must not be frozen at build time.
export const dynamic = "force-dynamic";

const CHANNEL = { prod: "production", beta: "beta" };

function rolloutLine(g) {
  const state =
    g.status === "complete"
      ? "complete"
      : g.status === "abandoned"
        ? "pulled back"
        : `on ~${pct(g.share)} of sampled CDN edges`;
  const first = new Date(g.firstSeenAt).toISOString().slice(0, 10);
  return (
    `- [Office.js ${groupTitle(g)} (${CHANNEL[g.channel]})](${SITE_URL}/rollouts/${g.channel}/${encodeURIComponent(g.group)}): ` +
    `first seen ${first}, ${g.files} file(s), ${state}, severity ${g.severity}, ${g.apiChangeCount} API change(s)`
  );
}

function typeLine(t) {
  const kinds = t.kinds.map((k) => (KIND_LABEL[k] ?? k).toLowerCase()).join(", ");
  const channels = t.channels.map((c) => CHANNEL[c]).join(" and ");
  return `- [${t.type}](${SITE_URL}${typeHref(t.type)}): ${kinds} on ${channels}, severity ${t.severity}`;
}

/** llms.txt (https://llmstxt.org): what the site is and where the useful pages are, in Markdown. */
export async function GET() {
  const [{ rollouts }, { types }] = await Promise.all([
    apiGetOr("/api/rollouts?limit=20", { rollouts: [] }),
    apiGetOr("/api/types", { types: [] }),
  ]);
  const body = `# ${SITE.name}

> ${SITE.name} monitors the Office.js CDN (appsforoffice.microsoft.com/lib/1/hosted/ and /lib/beta/hosted/). Every 10 minutes it samples every Office.js file on several CDN edges, tracks each new build as a rollout (which files, what share of edges serve it, since when) and diffs the public API surface (Office, Excel, Word, PowerPoint, OneNote, Visio, Outlook).

Use it to answer "did Office.js change on the CDN?" and "which APIs changed in build X?". Shares are measured across sampled CDN edge responses, not across users. Severity: high = a public GA API was removed or its signature or enum values changed; medium = a public GA function body changed; low = additions, preview or undocumented APIs, strings, telemetry.

Limits: only the JavaScript layer served from the CDN is visible. Breakages inside native Office hosts (Outlook, Excel win32, Mac) are not. The site publishes metadata and API-surface diffs only, never Microsoft's code. Not affiliated with Microsoft.

## Pages

- [Live changelog](${SITE_URL}/): current build per channel, rollouts in progress, recent rollouts
- [RSS feed](${SITE_URL}/rss.xml): one item per rollout, newest first
- [Office.js API changes](${SITE_URL}/reference): every class, enum and function whose public API changed, one page per type with its history
- [Sitemap](${SITE_URL}/sitemap.xml): every rollout and API type page

## Recent rollouts

${rollouts.length ? rollouts.map(rolloutLine).join("\n") : "- No rollouts recorded yet."}

## Recently changed APIs

${types.length ? types.slice(0, 20).map(typeLine).join("\n") : "- No API changes recorded yet."}

## Optional

- [Privacy policy](${SITE_URL}/privacy)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
