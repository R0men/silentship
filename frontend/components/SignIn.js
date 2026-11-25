"use client";

import { useState } from "react";
import { signupSource } from "@/lib/analytics";
import { useToast } from "./Toast";

const ERRORS = {
  invalid_email: "That email doesn't look right.",
  invalid_code: "That code is wrong or expired. Check the newest email, or send a new code.",
  too_many_requests: "Too many attempts. Try again later.",
};

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(), { code: body.error ?? (res.status === 429 ? "too_many_requests" : null) });
  return body;
}

/**
 * Sign-in to the alert settings without a password: the inbox proves the address. A subscribed address gets
 * a 6-digit code (and a button for the device that reads the email); a new one gets the confirmation email,
 * whose button opens the settings. The API answers the same either way.
 */
export default function SignIn({ notice, onSignedIn }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(ERRORS[err.code] ?? "Something went wrong. Please try again.", true);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e) => {
    e.preventDefault();
    run(async () => {
      await post("/api/signin", { email, source: signupSource() });
      setSentTo(email.trim());
      setCode("");
    });
  };

  const verify = (e) => {
    e.preventDefault();
    run(async () => {
      const body = await post("/api/signin/verify", { email: sentTo, code });
      onSignedIn(body.token, body.email);
    });
  };

  if (!sentTo) {
    return (
      <form className="signin" onSubmit={sendCode}>
        {notice && <p className="settings-error">{notice}</p>}
        <p className="muted">
          Enter the email that gets the alerts. We send you a code, no password needed. A new address gets a
          confirmation email instead, and its button brings you back here.
        </p>
        <div className="field">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            aria-label="Email"
            autoComplete="email"
          />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="signin" onSubmit={verify}>
      <p className="muted">
        We sent an email to <b>{sentTo}</b>. Enter the 6-digit code from it, or press its button. If this address is
        not subscribed yet, the email asks you to confirm instead.
      </p>
      <div className="field">
        <input
          className="mono signin-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="123456"
          aria-label="Code"
        />
        <button className="btn" type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Sign in"}
        </button>
      </div>
      <p className="fineprint">
        <button type="button" className="link-button" onClick={() => setSentTo(null)}>
          Use another email
        </button>
        {" · "}
        <button type="button" className="link-button" disabled={busy} onClick={() => run(async () => {
          await post("/api/signin", { email: sentTo, source: signupSource() });
          toast("Sent a new email.");
        })}>
          Send a new code
        </button>
      </p>
    </form>
  );
}
