import Link from "next/link";
import { fmtDay, listNotes } from "@/lib/notes";

/**
 * The newest write-ups on the home page, after the rollout feed: a note explains a
 * build in words, which the numbers above it cannot. Server component; notes are files in content/notes.
 */
export default function LatestNotes({ limit = 3 }) {
  const notes = listNotes().slice(0, limit);
  if (!notes.length) return null;
  return (
    <section className="home-notes" aria-labelledby="home-notes-title">
      <div className="section-head">
        <div>
          <h2 id="home-notes-title">Notes</h2>
          <p className="muted">What changed in recent builds and what it means for add-ins.</p>
        </div>
        <Link className="muted" href="/notes">
          All notes →
        </Link>
      </div>
      <div className="note-cards">
        {notes.map((n) => (
          <Link className="note-card" href={n.path} key={n.slug}>
            <time className="faint mono" dateTime={n.date}>
              {fmtDay(n.date)}
            </time>
            <span className="note-card-title">{n.title}</span>
            <span className="note-card-text muted">{n.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
