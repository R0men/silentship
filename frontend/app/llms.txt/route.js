import { apiGet } from "@/lib/api";
import { typeHref } from "@/lib/apiType";
import { channelLabel, groupTitle, KIND_LABEL, pct } from "@/lib/format";
import { listNotes } from "@/lib/notes";
import { SITE, SITE_URL } from "@/lib/site";

// Rendered per request like the sitemap: the list of rollouts must not be frozen at build time.
export const dynamic = "force-dynamic";

function rolloutLine(g) {
  const state =
    g.status === "complete"
      ? "complete"
      : g.status === "abandoned"
        ? "pulled back"
        : `on ~${pct(g.share)} of sampled CDN edges`;
  const from = g.fromBuilds.length ? `from ${g.fromBuilds.join(", ")}, ` : "";
  return (
    `- [Office.js ${groupTitle(g)} (${channelLabel(g.channel).toLowerCase()})](${SITE_URL}/rollouts/${g.channel}/${encodeURIComponent(g.group)}): ` +
    `${from}first seen ${day(g.firstSeenAt)}, ${g.files} file(s), ${state}, severity ${g.severity}, ${g.apiChangeCount} API change(s)`
  );
}

function typeLine(t) {
  const kinds = t.kinds.map((k) => (KIND_LABEL[k] ?? k).toLowerCase()).join(", ");
  const channels = t.channels.map((c) => channelLabel(c).toLowerCase()).join(" and ");
  return (
    `- [${t.type}](${SITE_URL}${typeHref(t.type)}): ${kinds} on ${channels}, ${t.changes} change(s), ` +
    `latest first seen ${day(t.lastSeenAt)}, severity ${t.severity}`
  );
}

const day = (d) => new Date(d).toISOString().slice(0, 10);

/** llms.txt (https://llmstxt.org): what the site is and where the useful pages are, in Markdown. */
export async function GET() {
  let rollouts;
  let types;
  try {
    [{ rollouts }, { types }] = await Promise.all([apiGet("/api/rollouts?limit=20"), apiGet("/api/types")]);
  } catch {
    // A down backend (e.g. mid-deploy) must not be cached by crawlers as "no rollouts recorded yet".
    return new Response("Temporarily unavailable\n", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "60" },
    });
  }
  const body = `# ${SITE.name}

> ${SITE.name} monitors the Office.js CDN on both endpoints: the legacy appsforoffice.microsoft.com/lib/1/hosted/ and /lib/beta/hosted/, and Microsoft's recommended OneCDN officeapis.public.onecdn.static.microsoft/1/ and /beta/ (same host files; its office.js also enables security defaults that stop loading MicrosoftAjax). Every 10 minutes it samples every Office.js file on several CDN edges, tracks each new build as a rollout (which files, what share of edges serve it, since when) and diffs the public API surface (Office, Excel, Word, PowerPoint, OneNote, Visio, Outlook).

Use it to answer "did Office.js change on the CDN?" and "which APIs changed in build X?". Shares are measured across sampled CDN edge responses, not across users. Severity: high = a public GA API was removed, its kind or arity changed, an enum value was removed or changed, a file was removed, or office.js changed its security-default flags (isOsfSecurityDefaultsEnabled, osfLoadMsAjax); medium = the body of a public GA function changed; low = everything else: new APIs and enum values, preview and undocumented APIs, changes in non-API files (strings, telemetry). An incomplete reflection never produces high.

Limits: only the JavaScript layer served from the CDN is visible. Breakages inside native Office hosts (Outlook, Excel win32, Mac) are not. The site publishes metadata and API-surface diffs only, never Microsoft's code. Not affiliated with Microsoft.

## Pages

- [Live changelog](${SITE_URL}/): current build per channel, rollouts in progress, recent rollouts
- [RSS feed](${SITE_URL}/rss.xml): one item per rollout, newest first
- [Office.js API changes](${SITE_URL}/reference): every class, enum and function whose public API changed, one page per type with its history
- [Notes](${SITE_URL}/notes): write-ups on observed rollouts and how the monitor works
- [Sitemap](${SITE_URL}/sitemap.xml): every rollout and API type page

## Notes

${listNotes()
  .map((n) => `- [${n.title}](${SITE_URL}${n.path}) (${n.date}): ${n.description}`)
  .join("\n")}

## Recent rollouts

${rollouts.length ? rollouts.map(rolloutLine).join("\n") : "- No rollouts recorded yet."}

## Recently changed APIs

One page per API type (class, enum, namespace object); a line counts changes to the type itself and to its members.

${types.length ? types.slice(0, 20).map(typeLine).join("\n") : "- No API changes recorded yet."}

## Optional

- [Privacy policy](${SITE_URL}/privacy)
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
