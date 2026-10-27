import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import Subscribe from "@/components/Subscribe";
import { breadcrumbs, officeJs, techArticle } from "@/lib/jsonLd";
import { fmtDay, getNote, listNotes } from "@/lib/notes";
import { NOTES_RSS, pageMeta } from "@/lib/site";

// Notes are files in the repository: every page is built ahead, an unknown slug is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return listNotes().map((n) => ({ slug: n.slug }));
}

// The note's own preview, rendered by ./opengraph-image.js.
const ogImage = (note) => ({ url: `${note.path}/opengraph-image`, width: 1200, height: 630, alt: note.title });

export async function generateMetadata({ params }) {
  const note = getNote((await params).slug);
  return pageMeta({
    path: note.path,
    title: note.seoTitle ?? note.title,
    description: note.description,
    type: "article",
    image: ogImage(note),
    keywords: note.keywords,
    article: { publishedTime: note.date, modifiedTime: note.updated ?? note.date, tags: note.keywords },
    rss: NOTES_RSS,
  });
}

export default async function Note({ params }) {
  const note = getNote((await params).slug);
  if (!note) notFound();
  const others = listNotes().filter((n) => n.slug !== note.slug).slice(0, 3);
  return (
    <article className="prose post">
      <JsonLd
        data={[
          techArticle({
            path: note.path,
            headline: note.title,
            description: note.description,
            datePublished: note.date,
            dateModified: note.updated,
            about: officeJs(),
            keywords: note.keywords,
            image: ogImage(note).url,
          }),
          breadcrumbs([
            ["Notes", "/notes"],
            [note.title, note.path],
          ]),
        ]}
      />
      <Link className="back" href="/notes">
        ← Notes
      </Link>
      <h1>{note.title}</h1>
      <p className="muted">
        <time dateTime={note.date}>{fmtDay(note.date)}</time>
        {note.checked && <span className="faint"> · checked {note.checked}</span>}
      </p>
      <div dangerouslySetInnerHTML={{ __html: note.before }} />
      {note.subscribe && (
        <aside className="post-subscribe">
          <p>{note.subscribe}</p>
          <Subscribe />
        </aside>
      )}
      {note.after && <div dangerouslySetInnerHTML={{ __html: note.after }} />}

      {/* Internal links: every note leads to the live data and to the other notes. */}
      <nav className="post-more" aria-label="More from silentship">
        <h2>More from silentship</h2>
        <ul>
          {others.map((n) => (
            <li key={n.slug}>
              <Link href={n.path}>{n.title}</Link>
            </li>
          ))}
          <li>
            <Link href="/#rollouts">Office.js rollouts on the CDN, live</Link>
          </li>
          <li>
            <Link href="/reference">Office.js API changes by type</Link>
          </li>
          <li>
            <a href="/rss.xml">RSS feed of new Office.js builds</a>
          </li>
        </ul>
      </nav>
    </article>
  );
}
