"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";
import { apiChangesText, severityPhrase, shortBuild } from "@/lib/format";
import { AnimatedNumber, useLive } from "./Live";

/** The biggest rollout in flight on a channel (most files), if any. */
function mainRollout(channel) {
  return [...(channel?.active ?? [])].filter((g) => g.toBuild).sort((a, b) => b.files - a.files)[0] ?? null;
}

const percent = (v) => `${Math.round(v * 100)}%`;

/**
 * The hero states what is happening on the CDN right now, with live numbers.
 * Wording is deliberate: we measure the share of CDN edge responses we sample, not of users. Users get a
 * new build the next time Office loads the add-in from an edge that has it.
 */
export default function Headline({ initial }) {
  const { data } = useLive(initial);
  const overview = data?.overview;
  const prod = overview?.channels.find((c) => c.channel === "prod");
  const beta = overview?.channels.find((c) => c.channel === "beta");
  const prodRollout = mainRollout(prod);
  const betaRollout = mainRollout(beta);
  const href = (c, g) => `/rollouts/${c}/${encodeURIComponent(g.group)}`;

  // Production first: a build on production matters to every add-in; beta is the early warning.
  const [channel, g] = prodRollout ? ["prod", prodRollout] : betaRollout ? ["beta", betaRollout] : [null, null];
  if (g) {
    return (
      <>
        <p className="eyebrow">
          <span className={`dot ${g.severity === "high" ? "dot-bad" : "dot-ok"}`} /> Rollout in progress ·{" "}
          {channel === "prod" ? "production" : "beta"}
        </p>
        <h1>
          Office.js{" "}
          <span className="h-build" title={g.toBuild}>
            {shortBuild(g.toBuild)}
          </span>{" "}
          is rolling out{channel === "beta" ? " on beta" : ""}:
          <span className="muted-h">
            {" "}
            <AnimatedNumber value={g.share} format={percent} /> of sampled edges, {severityPhrase(g)}.
          </span>
        </h1>
        <p className="lede">
          {g.files} host file{g.files === 1 ? " is" : "s are"} moving from{" "}
          <span className="mono">{g.fromBuilds.join(", ") || "the previous build"}</span>.{" "}
          {channel === "prod"
            ? "Your users get it the next time Office loads your add-in from an edge that has it."
            : "Beta often runs ahead of production — this is your early warning."}{" "}
          <Link
            className="lede-link"
            href={href(channel, g)}
            onClick={() => track("open_rollout", { channel, severity: g.severity, from: "headline" })}
          >
            {g.uniqueApiChanges ? `${apiChangesText(g)} →` : "See the rollout →"}
          </Link>
        </p>
      </>
    );
  }

  if (prod?.build) {
    return (
      <>
        <p className="eyebrow">
          <span className="dot dot-ok" /> Watching the Office.js CDN
        </p>
        <h1>
          Office.js{" "}
          <span className="h-build" title={prod.build}>
            {shortBuild(prod.build)}
          </span>{" "}
          is live everywhere.
          <span className="muted-h"> No rollout in progress.</span>
        </h1>
        <p className="lede">
          Every few minutes we sample each Office.js file across CDN edges. The moment Microsoft starts shipping a new
          build, you will see it here — and in your inbox.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="eyebrow">
        <span className="dot dot-ok" /> Live changelog of the Office.js CDN
      </p>
      <h1>
        Know when Office.js changes
        <span className="muted-h"> — before your users do.</span>
      </h1>
      <p className="lede">
        Microsoft ships Office.js from a fixed URL with no versions and no changelog. We sample every host file across
        CDN edges, diff the public API and show what is rolling out.
      </p>
    </>
  );
}
