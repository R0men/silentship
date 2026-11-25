import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/jsonLd";
import { pageMeta, SITE, SITE_URL } from "@/lib/site";

const TITLE = "Office.js changelog API: rollouts and API changes as JSON";
const DESCRIPTION =
  "A free read-only JSON API for Office.js CDN rollouts and public API changes per build. No key, CORS enabled, a stable v1 format.";

export const metadata = pageMeta({ path: "/developers", title: TITLE, description: DESCRIPTION });

const API = `${SITE_URL}/api/v1`;

function Fields({ rows }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Meaning</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, text]) => (
          <tr key={name}>
            <td>
              <code>{name}</code>
            </td>
            <td>{text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Documentation of the public API (backend/src/web/public-api.js). Static: nothing here depends on data. */
export default function Developers() {
  return (
    <article className="prose post">
      <JsonLd data={breadcrumbs([["API", "/developers"]])} />
      <Link className="back" href="/">
        ← Home
      </Link>
      <h1>Office.js changelog API</h1>
      <p className="muted">
        Everything the site shows about Office.js builds on the Microsoft CDN, as JSON: releases, how far each one has
        rolled out, and every public API change with its severity and documentation status.
      </p>

      <h2>The basics</h2>
      <ul>
        <li>
          Base URL <code>{API}</code>. Read-only <code>GET</code> requests, JSON responses, no key.
        </li>
        <li>
          CORS is open (<code>Access-Control-Allow-Origin: *</code>), so a browser page or an add-in can call it
          directly. Requests carry no cookies or credentials and nothing here is personal.
        </li>
        <li>
          <b>Rate limit:</b> 60 requests per minute per IP address (per /64 network for IPv6). Every response has{" "}
          <code>RateLimit-Limit</code>, <code>RateLimit-Remaining</code> and <code>RateLimit-Reset</code> (seconds); over
          the limit you get <code>429</code> with <code>Retry-After</code>.
        </li>
        <li>
          The data changes once per crawl, every 10 minutes, and responses may be cached for 60 seconds. Polling more
          often than every few minutes gains nothing.
        </li>
        <li>
          Metadata and API-surface diffs only — no Microsoft code, the same as the site. Not affiliated with Microsoft.
        </li>
      </ul>

      <h2>Stability</h2>
      <p>
        <b>v1 only grows.</b> Fields are added, never renamed, removed or changed in meaning. New values may appear in
        lists such as <code>kind</code>, <code>status</code> or <code>app</code>, so treat unknown values gracefully. A
        change that would break clients gets a new version, <code>/api/v2</code>, announced in the{" "}
        <a href={SITE_URL + "/notes"}>notes</a> while v1 keeps working.
      </p>

      <h2>Releases</h2>
      <p>
        One release is one Office.js build on one track: <code>prod</code> (what add-ins load from{" "}
        <code>/lib/1/hosted/</code>) or <code>beta</code>. Both CDN endpoints are combined, as on the site.
      </p>
      <pre>
        <code>{`curl "${API}/releases?track=prod&limit=10"`}</code>
      </pre>
      <p>
        Parameters, all optional: <code>track</code> (<code>prod</code>, <code>beta</code>), <code>severity</code>{" "}
        (<code>low</code>, <code>medium</code>, <code>high</code> — that exact severity), <code>limit</code> (1–100,
        default 30) and <code>before</code> (an ISO date: releases first seen before it). The response is{" "}
        <code>{`{ "releases": [...], "next": "<date>" | null }`}</code>; pass <code>next</code> as <code>before</code>{" "}
        for the next page.
      </p>
      <Fields
        rows={[
          ["track", "prod or beta."],
          ["build", "The release's build number, e.g. 16.0.20710.15050; the key of the release."],
          ["toBuild / fromBuilds", "The build rolling out and the builds it replaces (null / empty when unversioned)."],
          ["filesRemoved", "true for a release that removed host files rather than shipping a build."],
          ["status", "rolling, complete (every sampled edge serves it), or pulledBack (Microsoft rolled it back)."],
          ["severity", "low, medium or high: the most severe API change, as explained on the site."],
          ["share", "Share of sampled CDN edges serving the build, 0–1."],
          ["files", "Host files the release touches."],
          ["apiChanges", "Unique API changes (by path and kind)."],
          ["loaderFlagsChanged", "office.js changed its security defaults (e.g. stopped loading MicrosoftAjax)."],
          ["firstSeenAt / lastSeenAt / completedAt", "ISO dates; completedAt is null until complete."],
          ["url", "The release page on silentship.dev."],
        ]}
      />

      <h3>One release</h3>
      <pre>
        <code>{`curl "${API}/releases/prod/16.0.20710.15050"`}</code>
      </pre>
      <p>
        The fields above, plus <code>hostFiles</code> (each host file: <code>file</code>, <code>host</code>,{" "}
        <code>platform</code>, <code>status</code>, <code>share</code>, <code>severity</code>, builds and dates) and{" "}
        <code>changes</code>:
      </p>
      <Fields
        rows={[
          ["path", "The changed API, e.g. Excel.Range.getCell or Office.context.ui.displayDialogAsync."],
          ["from", "For renamed: the old path; else null."],
          ["kind", "added, removed, renamed, arityChanged (signature), kindChanged (e.g. method → property), enumChanged, bodyChanged (same signature, new implementation)."],
          ["severity", "low, medium or high for this change."],
          ["type", "The API type it belongs to, the key of /types/{type}."],
          ["app", "Excel, Word, PowerPoint, Outlook, OneNote, Visio, or Common (the rest of Office, OfficeExtension, OfficeCore)."],
          ["documentation", "ga, preview or undocumented, from @types/office-js; null if unknown."],
          ["apiSet", "Requirement set, e.g. ExcelApi 1.7; null if none."],
          ["detail", "A short note such as a parameter count change or the enum values; null if none."],
          ["files", "Host files that carry the change."],
        ]}
      />

      <h2>API types</h2>
      <pre>
        <code>{`curl "${API}/types"
curl "${API}/types/Excel.Range"`}</code>
      </pre>
      <p>
        <code>/types</code> lists every API type (class, enum, namespace object) that a confirmed release changed:{" "}
        <code>type</code>, <code>app</code>, <code>documentation</code>, <code>apiSet</code>, <code>severity</code>,{" "}
        <code>tracks</code>, <code>changedPaths</code>, <code>lastSeenAt</code>, <code>url</code> and{" "}
        <code>builds</code> (per build: <code>build</code>, <code>tracks</code>, <code>kinds</code>,{" "}
        <code>severity</code>, <code>documented</code>, <code>firstSeenAt</code>). <code>/types/{"{type}"}</code> is
        one type&apos;s history: <code>docsUrl</code> (Microsoft Learn) and <code>changes</code>, each a change as above
        with its <code>track</code>, <code>build</code>, <code>status</code>, dates and <code>pulledBackFiles</code>.
        The lookup ignores case; <code>type</code> in the response is the exact spelling.
      </p>

      <h2>Errors</h2>
      <p>
        Errors are JSON with a fixed code: <code>400</code> <code>{`{"error":"invalid_limit"}`}</code> (also{" "}
        <code>invalid_track</code>, <code>invalid_severity</code>, <code>invalid_before</code>), <code>404</code>{" "}
        <code>not_found</code>, <code>429</code> <code>rate_limited</code> or <code>busy</code> (the API as a whole
        is at its limit; retry after <code>Retry-After</code> seconds) and <code>500</code> <code>internal</code>.
      </p>

      <h2>Other ways to follow</h2>
      <p>
        No code needed: the <a href="/rss.xml">RSS feed</a> has one item per release, and{" "}
        <Link href="/#subscribe">email alerts</Link> can be narrowed to your applications and the APIs your add-in
        uses. Questions or a field you miss: <a href={`${SITE.repo}/issues`}>GitHub issues</a>.
      </p>
    </article>
  );
}
