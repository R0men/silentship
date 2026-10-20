import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

// Notes are Markdown files in frontend/content/notes: `<slug>.md` with a front matter of
// `title` (the h1), `description` (meta, ≤160 chars), `date` (YYYY-MM-DD) and optionally `seoTitle` (the
// <title> when it should differ from the h1), `updated` (YYYY-MM-DD), `keywords` (comma-separated) and
// `checked` (when the facts were last verified). Read at build time; a new note needs a deploy.
const DIR = join(process.cwd(), "content", "notes");

// `<!-- subscribe: lead text -->` on its own line places the subscribe form there.
const SUBSCRIBE = /<!--\s*subscribe:\s*(.*?)\s*-->\n?/;

const unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");

// A real calendar day: the round trip rejects 2026-02-30, which Date would roll over to March.
const isDay = (v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

function parse(slug) {
  const text = readFileSync(join(DIR, `${slug}.md`), "utf8").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`notes/${slug}.md: no front matter`);
  const meta = Object.fromEntries(
    m[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), unquote(line.slice(i + 1).trim())];
    }),
  );
  for (const key of ["title", "description", "date"]) {
    if (!meta[key]) throw new Error(`notes/${slug}.md: front matter has no ${key}`);
  }
  // A bad date passes the build but makes the sitemap's toISOString() throw, so it fails here instead.
  for (const key of ["date", "updated"]) {
    if (meta[key] !== undefined && !isDay(meta[key])) {
      throw new Error(`notes/${slug}.md: ${key} "${meta[key]}" is not a YYYY-MM-DD date`);
    }
  }
  return {
    ...meta,
    keywords: meta.keywords ? meta.keywords.split(",").map((k) => k.trim()) : undefined,
    slug,
    path: `/notes/${slug}`,
    body: text.slice(m[0].length),
  };
}

/** "20 Oct 2026" from a front matter date. */
export const fmtDay = (date) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Every note, newest first, without the rendered body. */
export function listNotes() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { body, ...meta } = parse(f.slice(0, -3));
      return meta;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * One note with its body rendered to HTML (our own Markdown, so the HTML is trusted): `before`, and when
 * the note has a subscribe marker, its `subscribe` lead and the `after` part.
 */
export function getNote(slug) {
  if (!listNotes().some((n) => n.slug === slug)) return null;
  const { body, ...meta } = parse(slug);
  const [before, subscribe, after] = body.split(SUBSCRIBE);
  const html = (md) => marked.parse(md, { gfm: true });
  return { ...meta, before: html(before), subscribe, after: after === undefined ? undefined : html(after) };
}
