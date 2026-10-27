"use client";

import Link from "next/link";
import { channelLabel, CHANNELS, ENDPOINTS, fmtDate, groupTitle, pct, shortBuild, STATUS_LABEL } from "@/lib/format";
import { useLive } from "./Live";
import { ShareBar, TimeAgo } from "./ui";

/** "Same build on legacy and onecdn", or which endpoint serves what. */
function Endpoints({ endpoints }) {
  const { legacy, onecdn } = endpoints ?? {};
  if (!legacy || !onecdn) return null;
  if (legacy.build && legacy.build === onecdn.build) {
    return (
      <div className="endpoints-line muted">
        Same build on {ENDPOINTS.legacy.label} and {ENDPOINTS.onecdn.label}
      </div>
    );
  }
  return (
    <div className="endpoints-line endpoints-differ">
      {ENDPOINTS.legacy.label} <span className="mono">{legacy.build ?? "—"}</span> · {ENDPOINTS.onecdn.label}{" "}
      <span className="mono">{onecdn.build ?? "—"}</span>
    </div>
  );
}

function Channel({ c }) {
  const fresh = c.lastCrawlAt && Date.now() - new Date(c.lastCrawlAt).getTime() < 45 * 60_000;
  const state = c.lastStatus === "failed" ? "bad" : c.lastStatus === "running" || fresh ? "ok" : "idle";
  const label =
    c.lastStatus === "failed"
      ? "last check failed"
      : c.lastStatus === "running"
        ? "checking the CDN now…"
        : fresh
          ? "monitoring"
          : "idle";
  return (
    <div className="channel">
      <div className="channel-head">
        <span className="label">
          {channelLabel(c.channel)}
          <span className="faint"> {CHANNELS[c.channel]?.where}</span>
        </span>
        <span className="live">
          <span className={`dot dot-${state}`} />
          {label}
        </span>
      </div>
      <div className="build">{c.build ?? "—"}</div>
      <Endpoints endpoints={c.endpoints} />
      <div className="muted channel-meta">
        <TimeAgo date={c.lastCrawlAt} prefix="checked " /> · {c.samples} samples per file
      </div>
      {c.active.map((g) => (
        <Link key={g.group} className="channel-rollout" href={`/rollouts/${c.channel}/${encodeURIComponent(g.group)}`}>
          <span>
            {g.toBuild ? (
              <>
                Rolling out <span className="mono">{g.toBuild}</span>
              </>
            ) : (
              groupTitle(g)
            )}
          </span>
          <span className="muted">
            <EndpointShares g={g} /> · {g.files} file{g.files === 1 ? "" : "s"}
          </span>
          <ShareBar share={g.share} />
        </Link>
      ))}
      {c.active.length === 0 && c.latest && <LatestRelease track={c.channel} g={c.latest} />}
      {c.active.length > 0 && c.previous && (
        <Link className="channel-previous muted" href={`/rollouts/${c.channel}/${encodeURIComponent(c.previous.group)}`}>
          previous: <span className="mono">{shortBuild(groupTitle(c.previous))}</span>{" "}
          {STATUS_LABEL[c.previous.status].toLowerCase()}
        </Link>
      )}
    </div>
  );
}

/** "legacy 1% · onecdn 3% of edges", or one share when only one endpoint rolls it out. */
function EndpointShares({ g }) {
  const sides = Object.keys(ENDPOINTS)
    .map((name) => [name, g.endpoints?.[name]])
    .filter(([, e]) => e && e.status !== "stable");
  if (sides.length < 2) return <>{pct(g.share)} of edges</>;
  return (
    <>
      {sides.map(([name, e], i) => (
        <span key={name}>
          {i > 0 && " · "}
          {ENDPOINTS[name].label} {pct(e.share)}
        </span>
      ))}{" "}
      of edges
    </>
  );
}

/** Nothing rolling: the newest release and how it ended, so the card is never just a number. */
function LatestRelease({ track, g }) {
  const complete = g.status === "complete";
  return (
    <Link className="channel-rollout" href={`/rollouts/${track}/${encodeURIComponent(g.group)}`}>
      <span>
        {STATUS_LABEL[g.status]} <span className="mono">{groupTitle(g)}</span>
      </span>
      <span className="muted">{complete && g.completedAt ? fmtDate(g.completedAt) : pct(g.share)}</span>
      <ShareBar share={complete ? 1 : g.share} status={g.status} />
    </Link>
  );
}

export default function ChannelStatus({ initial }) {
  const { data } = useLive(initial);
  const overview = data?.overview;
  if (!overview) return <p className="muted status-down">Monitor API is unreachable right now.</p>;
  return (
    <section className="status" id="status">
      {overview.channels.map((c) => (
        <Channel key={c.channel} c={c} />
      ))}
    </section>
  );
}
