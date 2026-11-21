"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";
import { apiChangesText, plural, severityPhrase, shortBuild, timeAgo } from "@/lib/format";
import { AnimatedNumber, useLive } from "./Live";

/** The biggest rollout in flight on a channel (most files), if any. */
function mainRollout(channel) {
  return [...(channel?.active ?? [])].filter((g) => g.toBuild).sort((a, b) => b.files - a.files)[0] ?? null;
}

const percent = (v) => `${Math.round(v * 100)}%`;

/** "15 API changes, none breaking" / "12 API changes, high severity" / "no public API changes". */
function latestPhrase(g) {
  if (!g.uniqueApiChanges) return g.severity === "high" ? "high severity" : "no public API changes";
  const count = plural(g.uniqueApiChanges, "API change");
  return g.severity === "high" || g.severity === "medium" ? `${count}, ${g.severity} severity` : `${count}, none breaking`;
}

/**
 * The line above the headline, inside the h1: "Office.js changelog" is what the page is, whatever the
 * headline says about the current build, so the h1 keeps the phrase people search for.
 */
function Eyebrow({ dot = "dot-ok", children }) {
  return (
    <span className="eyebrow">
      <span className={`dot ${dot}`} /> Office.js changelog · {children}{" "}
    </span>
  );
}

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
        <h1 className="hero-title">
          <Eyebrow dot={g.severity === "high" ? "dot-bad" : "dot-ok"}>
            rollout in progress · {channel === "prod" ? "production" : "beta"}
          </Eyebrow>
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
    // Nothing in flight: lead with the newest release instead of an empty "nothing happening".
    const latest = prod.latest?.toBuild ? prod.latest : null;
    return (
      <>
        {latest ? (
          <h1 className="hero-title">
            <Eyebrow>no rollout in progress</Eyebrow>
            Latest: Office.js{" "}
            <span className="h-build" title={latest.toBuild}>
              {shortBuild(latest.toBuild)}
            </span>
            <span className="muted-h">
              {" "}
              — {latestPhrase(latest)}.
            </span>
          </h1>
        ) : (
          <h1 className="hero-title">
            <Eyebrow>no rollout in progress</Eyebrow>
            Office.js{" "}
            <span className="h-build" title={prod.build}>
              {shortBuild(prod.build)}
            </span>{" "}
            is live everywhere.
            <span className="muted-h"> No rollout in progress.</span>
          </h1>
        )}
        <p className="lede">
          {latest?.status === "complete" && latest.completedAt && (
            // Server and browser render "ago" a moment apart.
            <span suppressHydrationWarning>Rolled out to every sampled edge {timeAgo(latest.completedAt)}. </span>
          )}
          Every 10 minutes we sample each Office.js file across CDN edges. The next build shows up here — and in your
          inbox.{" "}
          {latest && (
            <Link
              className="lede-link"
              href={href("prod", latest)}
              onClick={() => track("open_rollout", { channel: "prod", severity: latest.severity, from: "headline" })}
            >
              What changed in {shortBuild(latest.toBuild)} →
            </Link>
          )}
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="hero-title">
        <Eyebrow>live from the CDN</Eyebrow>
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
