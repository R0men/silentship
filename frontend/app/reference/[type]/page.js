import Link from "next/link";
import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import { LiveRefresh } from "@/components/Live";
import { ChannelTag, Severity } from "@/components/ui";
import { apiGet } from "@/lib/api";
import {
  advice,
  changePhrase,
  channelState,
  errorMessages,
  fileLabel,
  pageDescription,
  pageTitle,
  rolloutHref,
  statusLabel,
  typeHref,
} from "@/lib/apiType";
import { apiStatusLabel, fmtDate, groupTitle, KIND_LABEL, pct, STATUS_LABEL } from "@/lib/format";
import { breadcrumbs, officeJs, techArticle } from "@/lib/jsonLd";
import { pageMeta, SITE } from "@/lib/site";

export const dynamic = "force-dynamic";

const SEV = { low: 0, medium: 1, high: 2 };
// Kinds whose `detail` is the node kind (function, class, enum); for the rest it is already in the phrase.
const NODE_DETAIL = new Set(["removed", "added", "renamed"]);
const ENGINE = { Chromium: "Windows, web, Android (Chromium)", Safari: "Mac, iOS (Safari)" };

/** One backend call per request, shared by the metadata and the page. */
const load = cache(async (raw) => {
  const type = decodeURIComponent(raw);
  if (!/^[\w$.]{1,200}$/.test(type)) return { type, data: null };
  return { type, data: await apiGet(`/api/types/${encodeURIComponent(type)}`) };
});

export async function generateMetadata({ params }) {
  const { data } = await load((await params).type).catch(() => ({ data: null }));
  if (!data) return { title: "API not found", robots: { index: false } };
  return pageMeta({ path: typeHref(data.type), type: "article", title: pageTitle(data), description: pageDescription(data) });
}

/** `code` spans in advice text, nothing else. */
function Code({ text }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

function jsonLd(t, title, description) {
  const dates = t.events.map((e) => e.firstSeenAt).sort();
  return [
    techArticle({
      path: typeHref(t.type),
      headline: title,
      description,
      datePublished: dates[0],
      dateModified: t.lastModified ?? dates.at(-1),
      about: { "@type": "Thing", name: t.type, isPartOf: officeJs() },
    }),
    breadcrumbs([
      ["Office.js API changes", "/reference"],
      [t.type, typeHref(t.type)],
    ]),
  ];
}

export default async function ApiTypePage({ params }) {
  const { type, data: t } = await load((await params).type);
  if (!t) notFound();
  // One URL per type: another spelling (case) moves permanently to the canonical one.
  if (t.type !== type) permanentRedirect(typeHref(t.type));

  const title = pageTitle(t);
  const description = pageDescription(t);
  const severity = t.events.reduce((s, e) => (SEV[e.severity] > SEV[s] ? e.severity : s), "low");
  const anchored = new Set();
  const errors = errorMessages(t);
  // The h1 says what the title says: the API name large, what happened to it below.
  const [, name, rest] = /^([^\s:]+)(.*)$/.exec(title);

  return (
    <article className="release">
      <JsonLd data={jsonLd(t, title, description)} />
      <LiveRefresh />
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/reference">Office.js API changes</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/reference#${t.namespace.toLowerCase()}`}>{t.namespace}</Link>
      </nav>
      <div className="release-tags">
        <Severity value={severity} />
        {["prod", "beta"]
          .filter((c) => t.events.some((e) => e.channel === c))
          .map((c) => (
            <ChannelTag key={c} channel={c} />
          ))}
      </div>
      <h1 className="type-title">
        {name}
        <span className="type-title-sub">{rest}</span>
      </h1>
      {/* The reader's first question: does this concern a production add-in at all? */}
      <p className={`type-status type-status-${t.docs.status}`}>
        {statusLabel(t.docs)}
        {t.docs.url ? (
          <a href={t.docs.url}>Microsoft&apos;s documentation</a>
        ) : t.docs.status === "undocumented" ? (
          <span className="faint">Not in Microsoft&apos;s documentation</span>
        ) : null}
      </p>
      <p className="type-lede">{pageDescription(t, { lede: true })}</p>

      <dl className="facts">
        <div>
          <dt>Production</dt>
          <dd>{channelState(t, "prod")}</dd>
        </div>
        <div>
          <dt>Beta</dt>
          <dd>{channelState(t, "beta")}</dd>
        </div>
      </dl>

      <section className="type-section">
        <h2>What this means for your add-in</h2>
        {advice(t).map((p) => (
          <p key={p}>
            <Code text={p} />
          </p>
        ))}
      </section>

      {errors.length > 0 && (
        <section className="type-section">
          <h2>Errors you may see</h2>
          <p className="muted">
            In the add-in&apos;s console or error logs, on clients that loaded the new build. Parts in{" "}
            <code>&lt;…&gt;</code> come from your own code.
          </p>
          <ul className="errors">
            {errors.map((x) => (
              <li key={x.text}>
                <code>{x.text}</code>
                <span className="faint">{ENGINE[x.engine]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="type-section">
        <h2>Change history</h2>
        <div className="table type-table">
          <div className="tr th">
            <div>Change</div>
            <div>Build</div>
            <div>Severity</div>
            <div>Hosts</div>
          </div>
          {t.events.map((e) => {
            const id = e.path !== t.type && e.path.startsWith(`${t.type}.`) ? e.path.slice(t.type.length + 1) : null;
            const anchor = id && !anchored.has(id) ? (anchored.add(id), id) : undefined;
            // A rename links the page of the other name, unless both names are members of this type.
            const otherType = e.kind === "renamed" ? (e.fromType === t.type ? e.type : e.fromType) : null;
            const other = otherType && otherType !== t.type ? otherType : null;
            return (
              <div className="tr" id={anchor} key={`${e.channel}/${e.group}/${e.path}/${e.kind}`}>
                <div>
                  <div className="path">{changePhrase(e, t.type)}</div>
                  <div className="detail">
                    {NODE_DETAIL.has(e.kind) && e.detail && <span>{e.detail} </span>}
                    {other && (
                      <Link href={typeHref(other)}>{other} </Link>
                    )}
                    {apiStatusLabel(e) && (
                      <span className={`api-status api-${e.apiStatus ?? "ga"}`}>{apiStatusLabel(e)}</span>
                    )}
                  </div>
                </div>
                <div>
                  <Link className="mono" href={rolloutHref(e)}>
                    {groupTitle(e)}
                  </Link>
                  <div className="detail">
                    <ChannelTag channel={e.channel} /> {fmtDate(e.firstSeenAt)}
                  </div>
                  <div className="faint">
                    {STATUS_LABEL[e.status]}
                    {e.status === "rolling" ? ` · ${pct(e.share)}` : ""}
                  </div>
                </div>
                <div>
                  <Severity value={e.severity} />
                </div>
                <div className="hosts">
                  {e.files.map((f) => (
                    <span key={f} className="host" title={f}>
                      {fileLabel(f)}
                    </span>
                  ))}
                  {e.pulledFiles.map((f) => (
                    <span key={f} className="host faint" title={`${f} — pulled back`}>
                      <s>{fileLabel(f)}</s>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {t.related.length > 0 && (
        <section className="type-section">
          <h2>Changed in the same rollouts</h2>
          <ul className="type-links">
            {t.related.map((r) => (
              <li key={r.type}>
                <Link className="mono" href={typeHref(r.type)}>
                  {r.type}
                </Link>{" "}
                <span className="faint">{KIND_LABEL[r.kind]?.toLowerCase() ?? r.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="type-section">
        <h2>Source</h2>
        <p className="muted">
          {SITE.name} samples every Office.js file on the CDN every 10 minutes and compares the public API surface of
          each new build with the previous one by reflection. This page lists what changed for {t.type}; it does not
          include Microsoft&apos;s code. The API status comes from Microsoft&apos;s published type definitions
          (@types/office-js and @types/office-js-preview).{" "}
          {t.docs.url ? (
            <>
              Documentation: <a href={t.docs.url}>{t.type} on Microsoft Learn</a>.
            </>
          ) : t.docs.status === "undocumented" ? (
            <>{t.type} is not in Microsoft&apos;s documentation.</>
          ) : (
            // Documented, but as part of another page (a function or an object such as Office.context.ui).
            <>
              Documentation:{" "}
              <a href={`https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(t.type)}`}>
                search Microsoft Learn for {t.type}
              </a>
              .
            </>
          )}
        </p>
      </section>
    </article>
  );
}
