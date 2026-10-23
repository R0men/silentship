import Link from "next/link";
import { notFound } from "next/navigation";
import RolloutView from "@/components/RolloutView";
import JsonLd from "@/components/JsonLd";
import { LiveRefresh } from "@/components/Live";
import { ChannelTag, Severity, ShareBar, TimeAgo } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { apiChangesText, channelLabel, CHANNELS, ENDPOINTS, fmtDate, groupTitle, pct, plural, STATUS_LABEL } from "@/lib/format";
import { breadcrumbs, officeJs, techArticle } from "@/lib/jsonLd";
import { ENDPOINTS_NOTE, pageMeta } from "@/lib/site";

export const dynamic = "force-dynamic";

async function load(params) {
  const { channel, group } = await params;
  if (!(channel in CHANNELS)) return null;
  return apiGet(`/api/rollouts/${channel}/${encodeURIComponent(decodeURIComponent(group))}`);
}

/** Path, title and description: one source for the metadata and the structured data. */
function describe(r) {
  const channel = channelLabel(r.channel).toLowerCase();
  return {
    path: `/rollouts/${r.channel}/${encodeURIComponent(r.group)}`,
    title: `Office.js ${groupTitle(r)} rollout (${channel})`,
    description: `Office.js ${groupTitle(r)}: ${apiChangesText(r).replace(/^No/, "no")}, on ${pct(r.status === "complete" ? 1 : r.share)} of sampled CDN edges across ${plural(r.files, "file")}. First seen ${fmtDate(r.firstSeenAt)}.`,
  };
}

function jsonLd(r) {
  const { path, title, description } = describe(r);
  return [
    techArticle({
      path,
      headline: title,
      description,
      datePublished: r.firstSeenAt,
      dateModified: r.completedAt ?? r.lastSeenAt,
      about: officeJs(r.toBuild),
    }),
    breadcrumbs([[title, path]]),
  ];
}

/** loader-flags-changed: the notice up to the docs reference, which becomes a link. */
function FlagsNotice({ flags }) {
  const [text] = flags.notice.split(" See Microsoft's");
  return (
    <p className="flags-notice">
      {text} <a href={flags.docs}>Microsoft&apos;s migration notes</a> ·{" "}
      <Link href={ENDPOINTS_NOTE}>what the flags do and who can break</Link>
    </p>
  );
}

/** One endpoint's progress: share, bar and when it completed, or why there is no bar. */
function EndpointProgress({ name, e }) {
  const label = ENDPOINTS[name];
  const head = (
    <div className="endpoint-head">
      <span className="endpoint-name">{label.label}</span>
      <span className="faint mono">{label.host}</span>
    </div>
  );
  if (!e || e.status === "stable") {
    return (
      <div className="endpoint">
        {head}
        <div className="muted">{e ? "served it when monitoring of this endpoint began" : "not seen yet"}</div>
      </div>
    );
  }
  return (
    <div className="endpoint">
      {head}
      <div className="endpoint-figure">
        <b>{pct(e.share)}</b>
        <span className="muted">
          {e.status === "complete"
            ? `complete${e.completedAt ? ` ${fmtDate(e.completedAt)}` : ""}`
            : e.status === "abandoned"
              ? "pulled back"
              : "of sampled edges (average over the last hour)"}
        </span>
      </div>
      <ShareBar share={e.share} status={e.status} />
    </div>
  );
}

const LOADER_NOTE = {
  identical: "office.js is identical too.",
  "flags-only": "office.js is identical except the security-default flags.",
  different: "office.js differs beyond the security-default flags.",
};

const FileList = ({ files }) =>
  files.map((f, i) => (
    <span key={f}>
      {i > 0 && ", "}
      <span className="mono">{f}</span>
    </span>
  ));

/**
 * Whether the endpoints serve the same host files for this build. Only files both serve on it are compared;
 * a file one endpoint still serves on an older build is listed as not there yet, not as a difference.
 */
function EndpointFiles({ r }) {
  if (!r.onecdnCrawled) return null;
  if (!r.endpoints.legacy || !r.endpoints.onecdn) {
    return <p className="note">Seen on {r.endpoints.legacy ? "legacy" : "onecdn"} only so far.</p>;
  }
  const late = Object.keys(ENDPOINTS).filter((e) => r.notYetOn?.[e]?.length);
  return (
    <p className={`note ${r.differentFiles.length ? "endpoints-differ" : ""}`}>
      {r.differentFiles.length ? (
        <>
          Host files that differ between endpoints on this build: <FileList files={r.differentFiles} />.
        </>
      ) : late.length ? (
        "Host files both endpoints serve on this build are byte-identical."
      ) : (
        "Host files byte-identical on both endpoints."
      )}
      {late.map((e) => (
        <span key={e}>
          {" "}
          Not yet on {ENDPOINTS[e].label}: <FileList files={r.notYetOn[e]} />.
        </span>
      ))}
      {LOADER_NOTE[r.loader] && <span className="faint"> {LOADER_NOTE[r.loader]}</span>}{" "}
      <Link className="faint-link" href={ENDPOINTS_NOTE}>
        What differs between the endpoints
      </Link>
    </p>
  );
}

export async function generateMetadata({ params }) {
  const r = await load(params).catch(() => null);
  if (!r) return { title: "Rollout not found", robots: { index: false } };
  return pageMeta({ ...describe(r), type: "article" });
}

export default async function RolloutPage({ params }) {
  const r = await load(params);
  if (!r) notFound();
  const share = r.status === "complete" ? 1 : r.share;

  return (
    <article className="release">
      <JsonLd data={jsonLd(r)} />
      <LiveRefresh />
      <Link className="back" href="/#rollouts">
        ← Rollouts
      </Link>
      <div className="release-tags">
        <Severity value={r.severity} />
        <ChannelTag channel={r.channel} />
        <span className={`rstatus rstatus-${r.status}`}>{STATUS_LABEL[r.status]}</span>
      </div>
      <h1 className="release-build">{groupTitle(r)}</h1>
      {r.fromBuilds.length > 0 && <p className="note">from {r.fromBuilds.join(", ")}</p>}
      {r.flags.map((f) => (
        <FlagsNotice key={f.endpoint} flags={f} />
      ))}

      <h2 className="sr-only">Edges on new version</h2>
      {r.onecdnCrawled ? (
        <div className="endpoints">
          <EndpointProgress name="legacy" e={r.endpoints.legacy} />
          <EndpointProgress name="onecdn" e={r.endpoints.onecdn} />
        </div>
      ) : (
        <div className="rollout-progress">
          <div className="rollout-figure">
            <span className="big">{pct(share)}</span>
            <span className="muted">
              {r.status === "complete"
                ? "of sampled edges — rollout complete"
                : "of sampled edges serve the new version (average over the last hour)"}
            </span>
          </div>
          <ShareBar share={share} status={r.status} />
        </div>
      )}
      <EndpointFiles r={r} />

      <dl className="facts">
        <div>
          <dt>First seen</dt>
          <dd>
            <TimeAgo date={r.firstSeenAt} />
          </dd>
        </div>
        <div>
          <dt>{r.status === "complete" ? "Completed" : "Last seen"}</dt>
          <dd>{r.status === "complete" && r.completedAt ? fmtDate(r.completedAt) : <TimeAgo date={r.lastSeenAt} />}</dd>
        </div>
        <div>
          <dt>Files</dt>
          <dd>
            {r.files}
            {Object.keys(ENDPOINTS)
              .filter((e) => r.notYetOn?.[e]?.length)
              .map((e) => (
                <span key={e} className="faint">
                  {" "}
                  ({r.notYetOn[e].length} not yet on {ENDPOINTS[e].label})
                </span>
              ))}
          </dd>
        </div>
        <div>
          <dt>API changes</dt>
          <dd>
            {r.uniqueApiChanges}
            {r.uniqueApiChanges > 0 && <span className="faint"> in {plural(r.apiChangeFiles, "file")}</span>}
          </dd>
        </div>
        <div>
          <dt>Observed from</dt>
          <dd>{r.region}</dd>
        </div>
      </dl>
      <RolloutView rollout={r} />
    </article>
  );
}
