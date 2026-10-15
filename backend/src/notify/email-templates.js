import { html } from "../util/html.js";

/**
 * Email HTML in the site's look: dark, flat, white as the only bright accent, severity colours.
 * Email clients ignore <style> blocks, web fonts and flexbox unevenly, so layout is nested tables with
 * inline styles, and colours are repeated as bgcolor attributes for clients that drop CSS backgrounds.
 */

const C = {
  bg: "#060607",
  panel: "#0d0d10",
  text: "#f4f4f5",
  muted: "#8d8f98",
  faint: "#55575f",
  hairline: "#1c1c21",
  high: "#ff5b6b",
  medium: "#f2b544",
  low: "#8d8f98",
  accent: "#7c8cff",
};
const SANS = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SEVERITY_COLOR = { high: C.high, medium: C.medium, low: C.low };
const CHANNEL_LABEL = { prod: "production", beta: "beta" };
const KIND_LABEL = {
  added: "added",
  removed: "removed",
  renamed: "renamed",
  kindChanged: "type changed",
  arityChanged: "parameters changed",
  enumChanged: "enum values changed",
  bodyChanged: "implementation changed",
};
const STATUS_LABEL = { rolling: "Rolling out", complete: "Complete", abandoned: "Pulled back" };

const pct = (share) => `${Math.round((share ?? 0) * 100)}%`;

function button(href, label) {
  return html`<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td bgcolor="${C.text}" style="border-radius:8px;">
        <a
          href="${href}"
          style="display:inline-block;padding:12px 22px;font:600 14px/1 ${SANS};color:${C.bg};text-decoration:none;border-radius:8px;"
          >${label}</a
        >
      </td>
    </tr>
  </table>`;
}

/** Page frame shared by every email: brand row, content, footer. `preheader` is the inbox preview line. */
function layout({ preheader, body, footer }) {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <meta name="supported-color-schemes" content="dark" />
        <title>silentship</title>
      </head>
      <body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg};">${preheader}</div>
        <table
          role="presentation"
          width="100%"
          cellpadding="0"
          cellspacing="0"
          border="0"
          bgcolor="${C.bg}"
          style="background:${C.bg};"
        >
          <tr>
            <td align="center" style="padding:40px 16px;">
              <table
                role="presentation"
                width="100%"
                cellpadding="0"
                cellspacing="0"
                border="0"
                style="max-width:560px;"
              >
                <tr>
                  <td style="padding:0 4px 32px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td
                          width="14"
                          height="14"
                          bgcolor="${C.accent}"
                          style="width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,#8b6cff,#3fa2ff);font-size:0;line-height:0;"
                        >
                          &nbsp;
                        </td>
                        <td style="padding-left:10px;font:600 15px/1 ${SANS};color:${C.text};letter-spacing:-0.01em;">
                          silentship
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 4px;font:400 15px/1.6 ${SANS};color:${C.text};">${body}</td>
                </tr>
                <tr>
                  <td style="padding:40px 4px 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td
                          style="border-top:1px solid ${C.hairline};padding-top:20px;font:400 12px/1.6 ${SANS};color:${C.faint};"
                        >
                          ${footer}
                          <br />Not affiliated with Microsoft. Metadata and API-surface diffs only — no Microsoft code.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>`.value;
}

/** Double opt-in email. */
export function confirmEmail({ link, channels }) {
  const watching = channels.includes("beta") ? "production and beta channels" : "production channel";
  const body = html`
    <h1 style="margin:0 0 12px;font:600 26px/1.25 ${SANS};color:${C.text};letter-spacing:-0.02em;">
      Confirm your alerts
    </h1>
    <p style="margin:0 0 28px;color:${C.muted};">
      One click and you will hear from us whenever Microsoft rolls out a change to Office.js on the CDN — the
      ${watching}, with the APIs that changed.
    </p>
    ${button(link, "Confirm subscription")}
    <p style="margin:28px 0 0;font:400 13px/1.6 ${SANS};color:${C.faint};">
      Or paste this link into your browser:<br />
      <a href="${link}" style="color:${C.muted};text-decoration:underline;word-break:break-all;">${link}</a>
    </p>
  `;
  return {
    subject: "Confirm your silentship alerts",
    text: `Confirm your subscription to silentship — Office.js CDN change alerts (${watching}):\n${link}\n\nIf you did not request this, ignore this email.`,
    html: layout({
      preheader: "One click to start getting Office.js CDN change alerts.",
      body,
      footer:
        "You received this because someone entered this address at silentship.dev. If it was not you, ignore this email — nothing happens without the click.",
    }),
  };
}

function severityLabel(severity) {
  return html`<span
    style="font:600 11px/1 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${SEVERITY_COLOR[severity]};"
    >${severity}</span
  >`;
}

function shareBar(share) {
  const filled = Math.max(0, Math.min(100, Math.round(share * 100)));
  const cells =
    filled >= 100
      ? html`<td height="4" bgcolor="${C.text}" style="height:4px;font-size:0;line-height:0;">&nbsp;</td>`
      : filled <= 0
        ? html`<td height="4" bgcolor="${C.hairline}" style="height:4px;font-size:0;line-height:0;">&nbsp;</td>`
        : html`<td width="${filled}%" height="4" bgcolor="${C.text}" style="height:4px;font-size:0;line-height:0;">
              &nbsp;
            </td>
            <td
              width="${100 - filled}%"
              height="4"
              bgcolor="${C.hairline}"
              style="height:4px;font-size:0;line-height:0;"
            >
              &nbsp;
            </td>`;
  return html`<table
    role="presentation"
    width="100%"
    cellpadding="0"
    cellspacing="0"
    border="0"
    style="border-radius:2px;overflow:hidden;"
  >
    <tr>
      ${cells}
    </tr>
  </table>`;
}

function fact(label, value) {
  return html`<td valign="top" style="padding:0 24px 0 0;">
    <div style="font:400 12px/1.4 ${SANS};color:${C.faint};">${label}</div>
    <div style="font:500 15px/1.5 ${SANS};color:${C.text};">${value}</div>
  </td>`;
}

function changeRow(e) {
  const what =
    e.kind === "renamed" && e.from ? `renamed from ${e.from.split(".").pop()}` : (KIND_LABEL[e.kind] ?? e.kind);
  const tag = e.status && e.status !== "ga" ? e.status : (e.apiSet ?? "");
  return html`<tr>
    <td valign="top" width="16" style="padding:11px 0 0;">
      <div
        style="width:6px;height:6px;border-radius:3px;background:${SEVERITY_COLOR[e.severity]};font-size:0;line-height:0;"
      >
        &nbsp;
      </div>
    </td>
    <td style="padding:6px 0;border-bottom:1px solid ${C.hairline};">
      <div style="font:400 13px/1.5 ${MONO};color:${C.text};word-break:break-all;">${e.path}</div>
      <div style="font:400 12px/1.5 ${SANS};color:${C.muted};">
        ${what}${tag ? html` · ${tag}` : ""} · ${e.hosts.join(", ")}
      </div>
    </td>
  </tr>`;
}

/**
 * Rollout alert for one subscriber. `entries` are the summarized API changes (one per path), already
 * filtered by the subscriber's watchlist; `more` is how many were cut off.
 */
export function alertEmail({
  channel,
  title,
  fromBuilds,
  severity,
  status,
  files,
  share,
  totalChanges,
  entries,
  more,
  url,
  unsubscribe,
  watched,
}) {
  const channelName = CHANNEL_LABEL[channel] ?? channel;
  const changesBlock = entries.length
    ? html`<h2 style="margin:36px 0 8px;font:600 13px/1 ${SANS};color:${C.muted};letter-spacing:0.02em;">
          ${watched ? "Changes matching your watchlist" : "API changes"}
        </h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${entries.map(changeRow)}
        </table>
        ${more ? html`<p style="margin:12px 0 0;font:400 13px/1.5 ${SANS};color:${C.muted};">… and ${more} more on the rollout page.</p>` : ""}`
    : html`<p style="margin:32px 0 0;color:${C.muted};">
        No public API changes in this rollout — the code changed without changing the API surface.
      </p>`;

  const body = html`
    <p style="margin:0 0 14px;">
      ${severityLabel(severity)}
      <span style="font:500 11px/1 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:${C.faint};"
        >&nbsp;·&nbsp; ${channelName}</span
      >
    </p>
    <h1 style="margin:0 0 6px;font:600 28px/1.2 ${MONO};color:${C.text};letter-spacing:-0.02em;">${title}</h1>
    <p style="margin:0 0 28px;color:${C.muted};">
      ${status === "complete" ? "Microsoft has rolled out" : "Microsoft is rolling out"} a new Office.js build on the
      ${channelName} CDN${fromBuilds.length ? html`, replacing ${fromBuilds.join(", ")}` : ""}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding:0 0 10px;">
          <span style="font:600 40px/1 ${SANS};color:${C.text};letter-spacing:-0.03em;">${pct(share)}</span>
          <span style="font:400 14px/1.4 ${SANS};color:${C.muted};"
            >&nbsp; of sampled CDN edges ${status === "complete" ? "serve it" : "already serve it"}</span
          >
        </td>
      </tr>
      <tr>
        <td>${shareBar(share)}</td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
      <tr>
        ${fact("Files", files)} ${fact("API changes", totalChanges)} ${fact("Status", STATUS_LABEL[status] ?? status)}
      </tr>
    </table>

    ${changesBlock}

    <div style="height:32px;line-height:32px;font-size:0;">&nbsp;</div>
    ${button(url, "View rollout")}
  `;

  return layout({
    preheader: `${title} on ${channelName}: ${files} file(s), ~${pct(share)} of edges, ${totalChanges} API change(s).`,
    body,
    footer: html`You get this because you subscribed to silentship alerts for the ${channelName} channel.
      <a href="${unsubscribe}" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a> in one click.`,
  });
}
