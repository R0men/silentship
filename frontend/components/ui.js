"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

export function Severity({ value }) {
  return <span className={`sev sev-${value}`}>{value}</span>;
}

export function ChannelTag({ channel }) {
  return <span className={`tag ${channel.endsWith("beta") ? "tag-beta" : ""}`}>{channel}</span>;
}

/** Relative time; re-rendered on the client so server and browser clocks never disagree visibly. */
export function TimeAgo({ date, prefix = "" }) {
  const [text, setText] = useState(() => timeAgo(date));
  useEffect(() => {
    setText(timeAgo(date));
    const id = setInterval(() => setText(timeAgo(date)), 30_000);
    return () => clearInterval(id);
  }, [date]);
  return (
    <span suppressHydrationWarning title={date ? new Date(date).toISOString() : undefined}>
      {prefix}
      {text}
    </span>
  );
}

/** Text-only segmented control. */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Hairline progress: how much of the CDN serves the new version. */
export function ShareBar({ share, status }) {
  const value = Math.max(0, Math.min(1, share ?? 0));
  return (
    <span
      className={`share share-${status ?? "rolling"}`}
      role="img"
      aria-label={`${Math.round(value * 100)}% of sampled edges`}
    >
      <span className="share-fill" style={{ width: `${value * 100}%` }} />
    </span>
  );
}

/** Share over time as a single white line; points are [time, share]. */
export function Sparkline({ points, width = 120, height = 22 }) {
  if (!points?.length) return null;
  const xs = points.map(([t]) => new Date(t).getTime());
  const min = Math.min(...xs);
  const span = Math.max(1, Math.max(...xs) - min);
  const coords = points.map(([t, s]) => [
    points.length === 1 ? width : ((new Date(t).getTime() - min) / span) * width,
    height - 1 - s * (height - 2),
  ]);
  if (coords.length === 1) coords.unshift([0, coords[0][1]]);
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
    </svg>
  );
}
