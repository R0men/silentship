"use client";

import Link from "next/link";
import { groupTitle, pct } from "@/lib/format";
import { useLive } from "./Live";
import { ShareBar, TimeAgo } from "./ui";

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
          {c.channel === "prod" ? "Production" : "Beta"}
          <span className="faint"> /lib/{c.channel === "prod" ? "1" : "beta"}/hosted</span>
        </span>
        <span className="live">
          <span className={`dot dot-${state}`} />
          {label}
        </span>
      </div>
      <div className="build">{c.build ?? "—"}</div>
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
            {pct(g.share)} of edges · {g.files} file{g.files === 1 ? "" : "s"}
          </span>
          <ShareBar share={g.share} />
        </Link>
      ))}
    </div>
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
