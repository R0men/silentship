"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { forget, remember, remembered } from "@/lib/account";
import SignIn from "./SignIn";
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
  invalid_link: "This sign-in link is not valid anymore. Sign in with your email again.",
  unsubscribed: "This address is unsubscribed. Subscribe again on the home page to get alerts.",
  not_confirmed: "Confirm your subscription first: the confirmation email has the button.",
};
const SAVE_ERRORS = {
  invalid_channels: "Choose at least one channel.",
  invalid_apps: "Choose at least one application.",
  invalid_pattern: "One of the APIs doesn't look like an Office.js path.",
  too_many_patterns: "That's more than 50 APIs. Use a wildcard such as Excel.Range.* instead.",
};

/** The token from `#token=…`; null when the page was opened without one. */
function tokenFromHash() {
  const m = /(?:^#|&)token=([\w-]+)/.exec(window.location.hash);
  return m ? m[1] : null;
}

const hostLabel = (h) => (h === "powerpoint" ? "PowerPoint" : h === "onenote" ? "OneNote" : h[0].toUpperCase() + h.slice(1));

/**
 * The subscriber's alert settings. The token comes from an email link (`#token=…`, then removed from the
 * address bar), from this browser's memory (lib/account.js), or from a sign-in code (SignIn); a token the API
 * no longer accepts is forgotten and the page asks to sign in.
 */
export default function Settings() {
  const toast = useToast();
  const [token, setToken] = useState(null);
  const [state, setState] = useState({ status: "loading" });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  // What the address brought, read once: the effect below may run twice (React dev), after the URL is cleaned.
  const arrival = useRef(null);

  const load = useCallback((t) => {
    setState({ status: "loading" });
    fetch(`/api/settings?token=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          forget();
          return setState({ status: "signin", notice: LOAD_ERRORS[body.error] ?? LOAD_ERRORS.invalid_link });
        }
        remember(t, body.email);
        setToken(t);
        setState({ status: "ready", email: body.email, hosts: body.hosts, appList: body.appList ?? [] });
        setForm({
          channels: body.channels,
          minSeverity: body.minSeverity,
          // No choice stored means every application: shown as all boxes ticked.
          apps: body.apps?.length ? body.apps : (body.appList ?? []).map(([a]) => a),
          watchItems: body.watchItems.length ? body.watchItems : [],
        });
      })
      .catch(() => setState({ status: "error" }));
  }, []);

  useEffect(() => {
    arrival.current ??= {
      welcome: new URLSearchParams(window.location.search).get("welcome") === "1",
      token: tokenFromHash(),
    };
    const { welcome: isWelcome, token: fromLink } = arrival.current;
    setWelcome(isWelcome);
    // The token leaves the address bar (and the history entry); this browser keeps it instead.
    if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
    const t = fromLink ?? remembered()?.token;
    if (t) load(t);
    else setState({ status: "signin" });
  }, [load]);

  if (state.status === "loading") return <p className="muted">Loading your settings…</p>;
  if (state.status === "error") {
    return (
      <p className="settings-error">
        Something went wrong. Please try again. <Link href="/settings">Reload</Link>
      </p>
    );
  }
  if (state.status === "signin") return <SignIn notice={state.notice} onSignedIn={(t) => load(t)} />;

  const signOut = () => {
    forget();
    setToken(null);
    setForm(null);
    setWelcome(false);
    setState({ status: "signin" });
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleChannel = (c) =>
    set({ channels: form.channels.includes(c) ? form.channels.filter((x) => x !== c) : [...form.channels, c] });
  const toggleApp = (a) =>
    set({ apps: form.apps.includes(a) ? form.apps.filter((x) => x !== a) : [...form.apps, a] });
  const setItem = (i, patch) => set({ watchItems: form.watchItems.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const addItem = (pattern = "") => {
    if (pattern && form.watchItems.some((w) => w.pattern === pattern)) return;
    set({ watchItems: [...form.watchItems.filter((w) => w.pattern.trim()), { pattern, hosts: [] }] });
  };
  const invalid = form.watchItems.filter((w) => w.pattern.trim() && !PATTERN.test(w.pattern.trim()));

  async function onSave(e) {
    e.preventDefault();
    if (!form.channels.length) return toast(SAVE_ERRORS.invalid_channels, true);
    if (state.appList.length && !form.apps.length) return toast(SAVE_ERRORS.invalid_apps, true);
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
      set({
        channels: body.channels,
        minSeverity: body.minSeverity,
        apps: body.apps?.length ? body.apps : state.appList.map(([a]) => a),
        watchItems: body.watchItems,
      });
      toast("Saved. The next alert follows these settings.");
    } catch (err) {
      toast(SAVE_ERRORS[err.code] ?? LOAD_ERRORS[err.code] ?? "Couldn't save. Please try again.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={onSave}>
      {welcome && (
        <div className="settings-welcome" role="status">
          <b>You&apos;re subscribed.</b> Now you can narrow the alerts to the applications and APIs your add-in uses.
          This browser remembers you: <b>Alerts</b> in the menu or <b>Manage alerts</b> on the home page brings you
          back here.
        </div>
      )}
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

      {state.appList.length > 0 && (
        <fieldset>
          <legend>Applications</legend>
          <p className="fineprint settings-lead">
            Only hear about API changes in the applications your add-in runs in. Outlook covers{" "}
            <code>Office.context.mailbox</code> and <code>Office.MailboxEnums</code>; Common API is the rest of{" "}
            <code>Office</code> and <code>OfficeExtension</code>, shared by every application.
          </p>
          <div className="settings-apps">
            {state.appList.map(([a, label]) => (
              <label className="check" key={a}>
                <input type="checkbox" checked={form.apps.includes(a)} onChange={() => toggleApp(a)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

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
        <button type="button" className="link-button faint" onClick={signOut}>
          Forget this browser
        </button>
      </div>
    </form>
  );
}
