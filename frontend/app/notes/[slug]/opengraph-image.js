import { ImageResponse } from "next/og";
import { getNote, listNotes } from "@/lib/notes";

export const alt = "silentship note";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return listNotes().map((n) => ({ slug: n.slug }));
}

// A preview per note with its own title; same look as app/opengraph-image.js. Rendered at build time.
export default async function Image({ params }) {
  const note = getNote((await params).slug);
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
          <span style={{ color: "#71717a", fontWeight: 400 }}>· notes</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2 }}>{note.title}</div>
          <div style={{ fontSize: 30, color: "#a1a1aa" }}>{`silentship.dev${note.path}`}</div>
        </div>
      </div>
    ),
    size,
  );
}
