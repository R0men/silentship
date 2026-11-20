"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "./Toast";

/** Same rule as backend/src/notify/settings.js: dotted identifiers, optionally ending in ".*". */
const PATTERN = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*(\.\*)?$/;
const EXAMPLES = ["Excel.Range.*", "Office.context.ui.displayDialogAsync", "Word.ContentControl.*", "Office.ribbon.*"];

const SEVERITIES = [
  ["low", "Every build that changes the API", "Additions and internal changes too."],
  ["medium", "Medium and high only", "The code behind a documented API changed, or something was removed."],
  ["high", "High only", "A documented API was removed, renamed or changed its signature."],
];

const LOAD_ERRORS = {
  missing: "This page needs the link from one of our emails.",
  invalid_link: "This link is not valid anymore. Use the link from a recent email.",
  unsubscribed: "This address is unsubscribed. Subscribe again on the home page to get alerts.",
  not_confirmed: "Confirm your subscription first: the confirmation email has the button.",
};
const SAVE_ERRORS = {
  invalid_channels: "Choose at least one channel.",
  invalid_pattern: "One of the APIs doesn't look like an Office.js path.",
  too_many_patterns: "That's more than 50 APIs. Use a wildcard such as Excel.Range.* instead.",
};

/** The token from `#token=…`; null when the page was opened without one. */
function tokenFromHash() {
  const m = /(?:^#|&)token=([\w-]+)/.exec(window.location.hash);
  return m ? m[1] : null;
}

const hostLabel = (h) => (h === "powerpoint" ? "PowerPoint" : h === "onenote" ? "OneNote" : h[0].toUpperCase() + h.slice(1));

export default function Settings() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [state, setState] = useState({ status: "loading" });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = tokenFromHash();
    if (!t) return setState({ status: "error", error: "missing" });
    setToken(t);
    fetch(`/api/settings?token=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setState({ status: "error", error: body.error ?? "invalid_link" });
        setState({ status: "ready", email: body.email, hosts: body.hosts });
        setForm({
          channels: body.channels,
          minSeverity: body.minSeverity,
          watchItems: body.watchItems.length ? body.watchItems : [],
        });
      })
      .catch(() => setState({ status: "error", error: "network" }));
  }, []);

  if (state.status === "loading") return <p className="muted">Loading your settings…</p>;
  if (state.status === "error") {
    return (
      <p className="settings-error">
        {LOAD_ERRORS[state.error] ?? "Something went wrong. Please try again."}{" "}
        <Link href="/#subscribe">Subscribe</Link>
      </p>
    );
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleChannel = (c) =>
    set({ channels: form.channels.includes(c) ? form.channels.filter((x) => x !== c) : [...form.channels, c] });
  const setItem = (i, patch) => set({ watchItems: form.watchItems.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const addItem = (pattern = "") => {
    if (pattern && form.watchItems.some((w) => w.pattern === pattern)) return;
    set({ watchItems: [...form.watchItems.filter((w) => w.pattern.trim()), { pattern, hosts: [] }] });
  };
  const invalid = form.watchItems.filter((w) => w.pattern.trim() && !PATTERN.test(w.pattern.trim()));

  async function onSave(e) {
    e.preventDefault();
    if (!form.channels.length) return toast(SAVE_ERRORS.invalid_channels, true);
    if (invalid.length) return toast(SAVE_ERRORS.invalid_pattern, true);
    setBusy(true);
    try {
      const res = await fetch(`/api/settings?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(), { code: body.error });
      set({ channels: body.channels, minSeverity: body.minSeverity, watchItems: body.watchItems });
      toast("Saved. The next alert follows these settings.");
    } catch (err) {
      toast(SAVE_ERRORS[err.code] ?? LOAD_ERRORS[err.code] ?? "Couldn't save. Please try again.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={onSave}>
      <p className="muted">
        Alerts go to <b>{state.email}</b>.
      </p>

      <fieldset>
        <legend>Channels</legend>
        <label className="check">
          <input type="checkbox" checked={form.channels.includes("prod")} onChange={() => toggleChannel("prod")} />
          Production <span className="faint">— what your users load</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.channels.includes("beta")} onChange={() => toggleChannel("beta")} />
          Beta <span className="faint">— often a week ahead of production</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Email me about</legend>
        {SEVERITIES.map(([value, label, hint]) => (
          <label className="check settings-radio" key={value}>
            <input
              type="radio"
              name="minSeverity"
              value={value}
              checked={form.minSeverity === value}
              onChange={() => set({ minSeverity: value })}
            />
            <span>
              {label}
              <span className="faint settings-hint">{hint}</span>
            </span>
          </label>
        ))}
        <p className="fineprint">A build that Microsoft pulls back always gets an email.</p>
      </fieldset>

      <fieldset>
        <legend>APIs your add-in uses</legend>
        <p className="fineprint settings-lead">
          With a list, you only hear about changes that touch these APIs. Leave it empty to hear about every build
          that changes the public API. End a path with <code>.*</code> to include everything under it.
        </p>
        {form.watchItems.map((w, i) => {
          const bad = w.pattern.trim() && !PATTERN.test(w.pattern.trim());
          return (
            <div className="watch-row" key={i}>
              <input
                className={`watch-input mono${bad ? " watch-bad" : ""}`}
                value={w.pattern}
                onChange={(e) => setItem(i, { pattern: e.target.value })}
                placeholder="Excel.Range.*"
                aria-label="API path"
                aria-invalid={bad || undefined}
                spellCheck={false}
                autoCapitalize="off"
              />
              <select
                className="watch-host"
                aria-label="Host"
                value={w.hosts[0] ?? ""}
                onChange={(e) => setItem(i, { hosts: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">All hosts</option>
                {state.hosts.map((h) => (
                  <option key={h} value={h}>
                    {hostLabel(h)} only
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="watch-remove"
                aria-label={`Remove ${w.pattern || "this API"}`}
                onClick={() => set({ watchItems: form.watchItems.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          );
        })}
        <div className="watch-actions">
          <button type="button" className="watch-add" onClick={() => addItem()}>
            + Add an API
          </button>
          <span className="faint">Examples:</span>
          {EXAMPLES.map((p) => (
            <button type="button" className="watch-example mono" key={p} onClick={() => addItem(p)}>
              {p}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="settings-save">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        <a className="faint" href={`/unsubscribe?token=${encodeURIComponent(token)}`}>
          Unsubscribe
        </a>
      </div>
    </form>
  );
}
