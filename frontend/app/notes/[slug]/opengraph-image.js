import { getNote, listNotes } from "@/lib/notes";
import { ogCard, OG_SIZE } from "@/lib/ogCard";

export const alt = "silentship note";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return listNotes().map((n) => ({ slug: n.slug }));
}

// A preview per note with its own title. Rendered at build time.
export default async function Image({ params }) {
  const note = getNote((await params).slug);
  return ogCard({ kicker: "notes", title: note.title, sub: `silentship.dev${note.path}` });
}
