import { ImageResponse } from "next/og";

// One look for every link preview (1200×630): the logo line, a large title and a muted line below it.
// Used by the opengraph-image.js files of the root, notes, rollout and API type pages.

export const OG_SIZE = { width: 1200, height: 630 };

/** A zero-width space: a line-break opportunity inside a long API path. */
const ZWSP = String.fromCharCode(0x200b);

/** Smaller type for long titles so they stay within three lines. */
const titleSize = (title, base) => (title.length > 90 ? base * 0.62 : title.length > 55 ? base * 0.8 : base);

/** `kicker`: words after the logo ("notes"); `sub`: the muted line under the title. */
export function ogCard({ kicker, title, sub, base = 68 }) {
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
          {kicker && <span style={{ color: "#71717a", fontWeight: 400 }}>{`· ${kicker}`}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: titleSize(title, base), fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>
            {/* Long API paths have no spaces: let them wrap after a dot. */}
            {title.replaceAll(".", `.${ZWSP}`)}
          </div>
          {sub && <div style={{ fontSize: 30, color: "#a1a1aa" }}>{sub}</div>}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
