import Link from "next/link";
import { cache } from "react";
import JsonLd from "@/components/JsonLd";
import HubFilter from "@/components/HubFilter";
import { ChannelTag, Severity } from "@/components/ui";
import { apiGetOr } from "@/lib/api";
import { statusLabel, typeHref } from "@/lib/apiType";
import { fmtDate, KIND_LABEL, latestChangeText, plural, shortBuild } from "@/lib/format";
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

const DAY = 24 * 60 * 60 * 1000;
/** A type whose first change we saw this recently is marked "new". */
const NEW_FOR = 7 * DAY;
/** Builds shown open; older ones fold into one <details>. */
const OPEN_BUILDS = 4;

const SEV_RANK = { low: 0, medium: 1, high: 2 };
/** A row of a build is documented when one of its changes in that build touched a documented API. */
const documented = (row) => row.build.documented;
/** A type for the A–Z index and the filter count: documented in any build. */
const everDocumented = (t) => t.builds.some((b) => b.documented);

/**
 * The hub by build, newest first: what each Office.js build changed, type by type. A visitor comes for what
 * is current, so the builds lead and the A–Z index of every type comes last.
 */
function byBuild(types, now) {
  const builds = new Map();
  for (const t of types) {
    const firstEver = t.builds.at(-1)?.firstSeenAt;
    const isNew = firstEver && now - new Date(firstEver).getTime() < NEW_FOR;
    for (const b of t.builds) {
      let e = builds.get(b.group);
      if (!e) {
        e = { group: b.group, firstSeenAt: b.firstSeenAt, channels: new Set(), rows: [] };
        builds.set(b.group, e);
      }
      if (b.firstSeenAt < e.firstSeenAt) e.firstSeenAt = b.firstSeenAt;
      for (const c of b.channels) e.channels.add(c);
      e.rows.push({ ...t, build: b, isNew: isNew && b === t.builds.at(-1) });
    }
  }
  return [...builds.values()]
    .map((e) => {
      const rows = e.rows.sort(
        (a, b) =>
          SEV_RANK[b.build.severity] - SEV_RANK[a.build.severity] ||
          Number(documented(b)) - Number(documented(a)) ||
          a.type.localeCompare(b.type),
      );
      const shown = rows.filter(documented);
      return {
        ...e,
        rows,
        documented: shown.length,
        severity: shown.reduce((m, r) => (SEV_RANK[r.build.severity] > SEV_RANK[m] ? r.build.severity : m), "low"),
        // Prefer the production page: both tracks share one build number and the same API changes.
        href: `/rollouts/${e.channels.has("prod") ? "prod" : "beta"}/${encodeURIComponent(e.group)}`,
      };
    })
    .sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt));
}

function BuildSection({ b }) {
  const internal = b.rows.length - b.documented;
  return (
    <section className="hub-build">
      <div className="hub-build-head">
        <h2>
          <Link className="mono" href={b.href}>
            {shortBuild(b.group)}
          </Link>
        </h2>
        <span className="faint">{fmtDate(b.firstSeenAt)}</span>
        {b.documented > 0 && <Severity value={b.severity} />}
        <span className="hub-build-count muted">
          {b.documented ? plural(b.documented, "documented type") : "no documented types"}
          {internal > 0 && <span className="hub-internal-count"> · {internal} undocumented</span>}
        </span>
      </div>
      <div className="table type-hub">
        {b.rows.map((t) => (
          <div className={`tr${documented(t) ? "" : " hub-undocumented"}`} key={t.type}>
            <div>
              <Link className="path" href={typeHref(t.type)}>
                {t.type}
              </Link>
              {t.isNew && <span className="hub-new">new</span>}
              <div className="detail">
                {documented(t) ? (
                  <span className={`api-status api-${t.docs.status}`}>{statusLabel(t.docs)}</span>
                ) : (
                  <span className="api-status api-undocumented">Undocumented</span>
                )}{" "}
                ·{" "}
                {t.build.kinds.map((k) => (KIND_LABEL[k] ?? k).toLowerCase()).join(", ")}
              </div>
            </div>
            <div className="hub-channels">
              {t.build.channels.map((c) => (
                <ChannelTag key={c} channel={c} />
              ))}
            </div>
            <div>
              <Severity value={t.build.severity} />
            </div>
          </div>
        ))}
        {b.documented === 0 && (
          <div className="hub-only-internal faint">Only undocumented APIs changed in this build.</div>
        )}
      </div>
    </section>
  );
}

export default async function ReferenceHub() {
  const { types, latest } = await load();
  const now = Date.now();
  const builds = byBuild(types, now);
  const byNamespace = new Map();
  for (const t of [...types].sort((a, b) => a.type.localeCompare(b.type))) {
    if (!byNamespace.has(t.namespace)) byNamespace.set(t.namespace, []);
    byNamespace.get(t.namespace).push(t);
  }
  const namespaces = [...byNamespace.keys()].sort();
  const open = builds.slice(0, OPEN_BUILDS);
  const older = builds.slice(OPEN_BUILDS);

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
        What each Office.js build on the Microsoft CDN changed in the public API, newest build first. Undocumented
        changes are internals that add-ins should not rely on, but they often show what Microsoft is building next.
      </p>

      {builds.length ? (
        <HubFilter documented={types.filter(everDocumented).length} all={types.length}>
          {open.map((b) => (
            <BuildSection b={b} key={b.group} />
          ))}
          {older.length > 0 && (
            <details className="hub-older">
              <summary>
                Older builds ({older.length}): {older.map((b) => shortBuild(b.group)).join(", ")}
              </summary>
              {older.map((b) => (
                <BuildSection b={b} key={b.group} />
              ))}
            </details>
          )}

          <section className="type-section hub-index">
            <h2>Every changed type, A–Z</h2>
            {namespaces.map((ns) => (
              <div className="hub-index-ns" key={ns}>
                <h3>{ns}</h3>
                <ul>
                  {byNamespace.get(ns).map((t) => (
                    <li key={t.type} className={everDocumented(t) ? "" : "hub-undocumented"}>
                      <Link className="mono" href={typeHref(t.type)}>
                        {t.type.slice(ns.length + 1)}
                      </Link>{" "}
                      <span className={`sev-dot sev-${t.severity}`} title={`${t.severity} severity`} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </HubFilter>
      ) : (
        <div className="empty">
          <b>No API changes recorded yet.</b> Types appear here once a rollout that changes the public API is
          confirmed on the CDN.
        </div>
      )}
    </article>
  );
}
