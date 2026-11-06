import Link from "next/link";
import { cache } from "react";
import JsonLd from "@/components/JsonLd";
import { ChannelTag, Severity } from "@/components/ui";
import { apiGetOr } from "@/lib/api";
import { statusLabel, typeHref } from "@/lib/apiType";
import { fmtDate, KIND_LABEL, latestChangeText } from "@/lib/format";
import { breadcrumbs, collectionPage } from "@/lib/jsonLd";
import { pageMeta } from "@/lib/site";

// New types appear after every rollout with API changes; never prerender at build time.
export const dynamic = "force-dynamic";

const TITLE = "Office.js API changelog: what changed in each CDN build";
const SUMMARY = "Every Office.js API added, removed or renamed on Microsoft's CDN, per build.";

/** One backend call per request, shared by the metadata and the page. */
const load = cache(() => apiGetOr("/api/types", { types: [], latest: null }));

/** The newest change that matters comes first, so the snippet updates itself with every such build. */
const describe = (latest) => (latest ? `${latestChangeText(latest)} ${SUMMARY}` : SUMMARY);

export async function generateMetadata() {
  const { latest } = await load();
  return {
    ...pageMeta({ path: "/reference", title: TITLE, description: describe(latest) }),
    title: { absolute: `${TITLE} | silentship` },
  };
}

export default async function ReferenceHub() {
  const { types, latest } = await load();
  const byNamespace = new Map();
  for (const t of types) {
    if (!byNamespace.has(t.namespace)) byNamespace.set(t.namespace, []);
    byNamespace.get(t.namespace).push(t);
  }
  const namespaces = [...byNamespace.keys()].sort();

  return (
    <article className="release">
      <JsonLd
        data={[
          collectionPage({
            path: "/reference",
            name: TITLE,
            description: describe(latest),
            items: types.map((t) => [t.type, typeHref(t.type)]),
          }),
          breadcrumbs([["Office.js API changelog", "/reference"]]),
        ]}
      />
      <h1 className="type-title">Office.js API changelog</h1>
      <p className="type-lede">
        Every class, enum and function whose public API changed in an Office.js build on the Microsoft CDN, newest
        first. Each page shows what changed, in which builds, on which hosts and how far the rollout got in production
        and beta.
      </p>
      {namespaces.length > 1 && (
        <nav className="crumbs" aria-label="Namespaces">
          {namespaces.map((ns) => (
            <a key={ns} href={`#${ns.toLowerCase()}`}>
              {ns} <span className="faint">{byNamespace.get(ns).length}</span>
            </a>
          ))}
        </nav>
      )}

      {namespaces.length ? (
        namespaces.map((ns) => (
          <section className="type-section" id={ns.toLowerCase()} key={ns}>
            <h2>{ns}</h2>
            <div className="table type-hub">
              {byNamespace.get(ns).map((t) => (
                <div className="tr" key={t.type}>
                  <div>
                    <Link className="path" href={typeHref(t.type)}>
                      {t.type}
                    </Link>
                    <div className="detail">
                      <span className={`api-status api-${t.docs.status}`}>{statusLabel(t.docs)}</span> ·{" "}
                      {t.kinds.map((k) => KIND_LABEL[k] ?? k).join(", ")}
                      {t.changes > 1 ? ` · ${t.changes} paths` : ""}
                    </div>
                  </div>
                  <div className="hub-channels">
                    {t.channels.map((c) => (
                      <ChannelTag key={c} channel={c} />
                    ))}
                  </div>
                  <div>
                    <Severity value={t.severity} />
                  </div>
                  <div className="faint">{fmtDate(t.lastSeenAt)}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="empty">
          <b>No API changes recorded yet.</b> Types appear here once a rollout that changes the public API is
          confirmed on the CDN.
        </div>
      )}
    </article>
  );
}
