import { ImageResponse } from "next/og";

export const alt = "silentship — know when Office.js changes on the CDN";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// One shared preview for every page; rendered once at build time.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#060607",
          color: "#f4f4f5",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 40, fontWeight: 600 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #8b6cff, #3fa2ff)",
            }}
          />
          silentship
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            Know when Office.js changes on the CDN
          </div>
          <div style={{ fontSize: 32, color: "#a1a1aa" }}>
            New builds, CDN rollout share and API diffs, checked every 10 minutes.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
