import Link from "next/link";
import { notFound } from "next/navigation";
import RolloutView from "@/components/RolloutView";
import JsonLd from "@/components/JsonLd";
import { LiveRefresh } from "@/components/Live";
import { ChannelTag, Severity, ShareBar, TimeAgo } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { fmtDate, groupTitle, pct, STATUS_LABEL } from "@/lib/format";
import { breadcrumbs, officeJs, techArticle } from "@/lib/jsonLd";
import { pageMeta } from "@/lib/site";

export const dynamic = "force-dynamic";

async function load(params) {
  const { channel, group } = await params;
  if (!["prod", "beta"].includes(channel)) return null;
  return apiGet(`/api/rollouts/${channel}/${encodeURIComponent(decodeURIComponent(group))}`);
}

/** Path, title and description: one source for the metadata and the structured data. */
function describe(r) {
  const channel = r.channel === "beta" ? "beta" : "production";
  return {
    path: `/rollouts/${r.channel}/${encodeURIComponent(r.group)}`,
    title: `Office.js ${groupTitle(r)} rollout (${channel})`,
    description: `Office.js ${groupTitle(r)} on ${pct(r.status === "complete" ? 1 : r.share)} of sampled CDN edges across ${r.files} files, ${r.apiChangeCount} API changes. First seen ${fmtDate(r.firstSeenAt)}.`,
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
          <dd>{r.files}</dd>
        </div>
        <div>
          <dt>API changes</dt>
          <dd>
            {r.apiChanges.length}
            <span className="faint"> ({r.apiChangeCount} across files)</span>
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
