import { listNotes } from "@/lib/notes";
import { SITE, SITE_URL } from "@/lib/site";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * RSS 2.0 of the notes, newest first. A feed of its own: /rss.xml is one item per rollout, and readers who
 * follow builds should not get essays in it. Notes change only with a deploy, so this is built once.
 */
export function GET() {
  const items = listNotes()
    .map((n) => {
      const link = `${SITE_URL}${n.path}`;
      return (
        `<item><title>${esc(n.title)}</title><link>${esc(link)}</link><guid isPermaLink="true">${esc(link)}</guid>` +
        `<pubDate>${new Date(`${n.date}T00:00:00Z`).toUTCString()}</pubDate><description>${esc(n.description)}</description></item>`
      );
    })
    .join("");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${SITE.name} — notes</title>` +
    `<link>${SITE_URL}/notes</link><description>Write-ups from watching the Office.js CDN</description>${items}</channel></rss>`;
  return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
