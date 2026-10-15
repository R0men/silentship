import { apiGetOr } from "@/lib/api";
import { SITE_URL } from "@/lib/site";

// Rendered per request, never at build time: a build without a running backend would bake in an empty
// list, and new rollouts must appear without a redeploy. One cheap aggregate per crawler visit.
export const dynamic = "force-dynamic";

export default async function sitemap() {
  const { rollouts } = await apiGetOr("/api/sitemap", { rollouts: [] });
  const newest = rollouts[0]?.lastModified ? new Date(rollouts[0].lastModified) : undefined;
  return [
    { url: `${SITE_URL}/`, lastModified: newest, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    ...rollouts.map((r) => ({
      url: `${SITE_URL}/rollouts/${r.channel}/${encodeURIComponent(r.group)}`,
      lastModified: r.lastModified ? new Date(r.lastModified) : undefined,
      changeFrequency: "daily",
      priority: r.channel === "prod" ? 0.8 : 0.6,
    })),
  ];
}
