import { apiGet } from "@/lib/api";
import { typeHref } from "@/lib/apiType";
import { listNotes } from "@/lib/notes";
import { SITE, SITE_URL } from "@/lib/site";

const latest = (rows) => {
  const d = rows.map((r) => r.lastModified).filter(Boolean).sort().at(-1);
  return d ? new Date(d) : undefined;
};

// Rendered per request, never at build time: a build without a running backend would bake in an empty
// list, and new rollouts must appear without a redeploy. One cheap aggregate per crawler visit.
export const dynamic = "force-dynamic";

export default async function sitemap() {
  // No fallback: with the backend down (e.g. mid-deploy) an error makes crawlers retry, while an empty
  // 200 would tell them every rollout and type page is gone.
  const { rollouts, types = [] } = await apiGet("/api/sitemap");
  const newest = rollouts[0]?.lastModified ? new Date(rollouts[0].lastModified) : undefined;
  const notes = listNotes();
  const latestNote = notes[0] ? new Date(notes[0].date) : undefined;
  return [
    { url: `${SITE_URL}/`, lastModified: newest, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date(SITE.updated), changeFrequency: "yearly", priority: 0.2 },
    {
      url: `${SITE_URL}/reference`,
      lastModified: latest(types),
      changeFrequency: "daily",
      priority: 0.7,
    },
    { url: `${SITE_URL}/notes`, lastModified: latestNote, changeFrequency: "weekly", priority: 0.6 },
    ...notes.map((n) => ({
      url: `${SITE_URL}${n.path}`,
      lastModified: new Date(n.updated ?? n.date),
      changeFrequency: "monthly",
      priority: 0.7,
    })),
    ...rollouts.map((r) => ({
      url: `${SITE_URL}/rollouts/${r.channel}/${encodeURIComponent(r.group)}`,
      lastModified: r.lastModified ? new Date(r.lastModified) : undefined,
      changeFrequency: "daily",
      priority: r.channel === "prod" ? 0.8 : 0.6,
    })),
    // Only types changed by a confirmed rollout have a page; see /api/types.
    ...types.map((t) => ({
      url: `${SITE_URL}${typeHref(t.type)}`,
      lastModified: t.lastModified ? new Date(t.lastModified) : undefined,
      changeFrequency: "weekly",
      priority: 0.5,
    })),
  ];
}
