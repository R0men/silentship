import { ogCard, OG_SIZE } from "@/lib/ogCard";

export const alt = "silentship — know when Office.js changes on the CDN";
export const size = OG_SIZE;
export const contentType = "image/png";

// One shared preview for pages without their own; rendered once at build time.
export default function Image() {
  return ogCard({
    title: "Know when Office.js changes on the CDN",
    sub: "New builds, CDN rollout share and API diffs, checked every 10 minutes.",
    base: 76,
  });
}
