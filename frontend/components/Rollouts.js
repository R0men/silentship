"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track, trackOnce } from "@/lib/analytics";
import { CHANNELS, divergence, groupTitle, pct, STATUS_LABEL } from "@/lib/format";
import { ChannelTag, Segmented, Severity, ShareBar, TimeAgo } from "./ui";
import { useToast } from "./Toast";
import { useLive, useLiveEvent } from "./Live";

const keyOf = (g) => `${g.channel}/${g.group}`;

/** Update rows we already show and put new ones on top, keeping pages loaded with "Load more". */
function merge(current, fresh) {
  const byKey = new Map(fresh.map((g) => [keyOf(g), g]));
  const kept = current.map((g) => byKey.get(keyOf(g)) ?? g);
  const known = new Set(current.map(keyOf));
  const added = fresh.filter((g) => !known.has(keyOf(g)));
  return [...added, ...kept].sort((a, b) => new Date(b.firstSeenAt) - new Date(a.firstSeenAt));
}

const PAGE = 30;

function Row({ g }) {
  const href = `/rollouts/${g.channel}/${encodeURIComponent(g.group)}`;
  const share = g.status === "complete" ? 1 : g.share;
  return (
    <Link
      className="row"
      href={href}
      onClick={() => track("open_rollout", { channel: g.channel, severity: g.severity, from: "list" })}
    >
      <Severity value={g.severity} />
      <div className="row-main">
        <div className="row-title">
          <span className="mono">{groupTitle(g)}</span>
          <ChannelTag channel={g.channel} />
          {divergence(g) && <span className="tag tag-diverged">{divergence(g)}</span>}
        </div>
        <div className="row-sub">
          {g.fromBuilds.length ? `from ${g.fromBuilds.join(", ")} · ` : ""}
          <TimeAgo date={g.firstSeenAt} prefix="started " />
        </div>
      </div>
      <div className="row-rollout">
        <div className="row-share">
          <span className={`rstatus rstatus-${g.status}`}>{STATUS_LABEL[g.status]}</span>
          <b>{pct(share)}</b>
        </div>
        <ShareBar share={share} status={g.status} />
      </div>
      <div className="row-counts">
        <span>
          <b>{g.files}</b> files
        </span>
        <span>
          <b>{g.apiChangeCount}</b> API
        </span>
      </div>
      <span className="row-arrow" aria-hidden="true">
        →
      </span>
    </Link>
  );
}

export default function Rollouts({ initial, initialOverview }) {
  const toast = useToast();
  const { data } = useLive(null);
  const stats = (data?.overview ?? initialOverview)?.stats;
  const [groups, setGroups] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [channel, setChannel] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [loading, setLoading] = useState(false);
  const section = useRef(null);

  // view_rollouts: the list scrolled into view, once per visit.
  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      trackOnce("view_rollouts");
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Live: the snapshot carries the unfiltered first page; with filters on, refetch that view instead.
  useLiveEvent(async (snapshot) => {
    if (channel === "all" && severity === "all") {
      setGroups((current) => merge(current, snapshot.rollouts));
      return;
    }
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (channel !== "all") q.set("channel", channel);
    if (severity !== "all") q.set("severity", severity);
    try {
      const res = await fetch(`/api/rollouts?${q}`);
      if (!res.ok) return;
      const { rollouts: fresh } = await res.json();
      setGroups((current) => merge(current, fresh));
    } catch {
      // Next update will try again.
    }
  });

  async function load({ reset, ch = channel, sev = severity }) {
    setLoading(true);
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (ch !== "all") q.set("channel", ch);
    if (sev !== "all") q.set("severity", sev);
    const last = reset ? null : groups[groups.length - 1];
    if (last) q.set("before", last.firstSeenAt);
    try {
      const res = await fetch(`/api/rollouts?${q}`);
      if (!res.ok) throw new Error();
      const { rollouts: page } = await res.json();
      setGroups(reset ? page : [...groups, ...page]);
      setDone(page.length < PAGE);
    } catch {
      toast("Could not load rollouts.", true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="changelog" id="rollouts" ref={section}>
      <div className="section-head">
        <div>
          <h2>Rollouts</h2>
          {stats && (
            <p className="muted">
              {stats.rollouts30d} build{stats.rollouts30d === 1 ? "" : "s"} rolled out in the last 30 days ·{" "}
              {stats.high30d} with high-severity changes
            </p>
          )}
        </div>
        <div className="filters">
          <Segmented
            label="Channel"
            value={channel}
            options={[["all", "All"], ...Object.entries(CHANNELS).map(([c, { label }]) => [c, label])]}
            onChange={(v) => {
              setChannel(v);
              load({ reset: true, ch: v });
            }}
          />
          <Segmented
            label="Severity"
            value={severity}
            options={[
              ["all", "Any"],
              ["high", "High"],
              ["medium", "Medium"],
              ["low", "Low"],
            ]}
            onChange={(v) => {
              setSeverity(v);
              load({ reset: true, sev: v });
            }}
          />
        </div>
      </div>

      <div className={`rows${loading ? " is-loading" : ""}`}>
        {groups.length ? (
          groups.map((g) => <Row key={`${g.channel}/${g.group}`} g={g} />)
        ) : (
          <div className="empty">
            <b>No rollouts yet.</b> The first crawl records which version every file is on; new builds show up here as
            they spread across the CDN.
          </div>
        )}
      </div>

      {!done && (
        <div className="more">
          <button className="link-btn" type="button" disabled={loading} onClick={() => load({ reset: false })}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}
