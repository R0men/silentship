import { apiGet } from "@/lib/api";
import { pageTitle } from "@/lib/apiType";
import { ogCard, OG_SIZE } from "@/lib/ogCard";

export const alt = "Office.js API change on silentship";
export const size = OG_SIZE;
export const contentType = "image/png";

// The preview of one API type page: the type large, what happened to it below. Rendered per request.
export default async function Image({ params }) {
  const type = decodeURIComponent((await params).type);
  const t = /^[\w$.]{1,200}$/.test(type) ? await apiGet(`/api/types/${encodeURIComponent(type)}`).catch(() => null) : null;
  if (!t) return new Response("Not found", { status: 404 });
  const [, name, rest] = /^([^\s:]+):?\s*(.*)$/.exec(pageTitle(t));
  return ogCard({ kicker: "API changes", title: name, sub: rest });
}
