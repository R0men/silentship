import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { breadcrumbs, collectionPage } from "@/lib/jsonLd";
import { fmtDay, listNotes } from "@/lib/notes";
import { NOTES_RSS, pageMeta } from "@/lib/site";

const TITLE = "Notes";
const DESCRIPTION =
  "Write-ups from watching the Office.js CDN: how Microsoft rolls out new builds across edges, what actually changed and what it means for Office add-ins.";

export const metadata = pageMeta({ path: "/notes", title: TITLE, description: DESCRIPTION, rss: NOTES_RSS });

export default function Notes() {
  const notes = listNotes();
  return (
    <article className="prose">
      <JsonLd
        data={[
          collectionPage({
            path: "/notes",
            name: TITLE,
            description: DESCRIPTION,
            items: notes.map((n) => [n.title, n.path]),
          }),
          breadcrumbs([[TITLE, "/notes"]]),
        ]}
      />
      <h1>Notes</h1>
      <p className="muted">
        {DESCRIPTION} <a href="/notes/rss.xml">RSS</a>
      </p>
      <ul className="post-list">
        {notes.map((n) => (
          <li key={n.slug}>
            <time className="faint mono" dateTime={n.date}>
              {fmtDay(n.date)}
            </time>
            <Link href={n.path}>{n.title}</Link>
            <p>{n.description}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}
