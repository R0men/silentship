import { apiGet } from "@/lib/api";
import { apiChangesText, channelLabel, CHANNELS, groupTitle, pct, STATUS_LABEL } from "@/lib/format";
import { ogCard, OG_SIZE } from "@/lib/ogCard";

export const alt = "Office.js rollout on silentship";
export const size = OG_SIZE;
export const contentType = "image/png";

// The preview of one release page: the build, its API changes, severity and how far it rolled out.
export default async function Image({ params }) {
  const { channel, group } = await params;
  const r =
    channel in CHANNELS
      ? await apiGet(`/api/rollouts/${channel}/${encodeURIComponent(decodeURIComponent(group))}`).catch(() => null)
      : null;
  if (!r) return new Response("Not found", { status: 404 });
  const state = r.status === "rolling" ? `rolling out, ${pct(r.share)} of edges` : STATUS_LABEL[r.status].toLowerCase();
  return ogCard({
    kicker: channelLabel(r.channel).toLowerCase(),
    title: `Office.js ${groupTitle(r)}`,
    sub: `${apiChangesText(r)} · ${r.severity} severity · ${state}`,
  });
}
