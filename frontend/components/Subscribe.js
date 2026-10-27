"use client";

import Link from "next/link";
import { useState } from "react";
import { signupSource, track, trackOnce } from "@/lib/analytics";
import { useToast } from "./Toast";

const ERRORS = {
  400: "That email doesn't look right.",
  429: "Too many attempts. Try again later.",
};

export default function Subscribe() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.email.value, beta: form.beta.checked, source: signupSource() }),
      });
      if (!res.ok) throw Object.assign(new Error(), { status: res.status });
      // Counted after the API accepted it, so failed attempts do not inflate the conversion.
      track("subscribe", { beta: form.beta.checked });
      form.reset();
      toast("Check your inbox — we sent you an email.");
    } catch (err) {
      toast(ERRORS[err.status] ?? "Something went wrong. Please try again.", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    // #subscribe: rollout pages link here ("Get email alerts →").
    <form className="subscribe" id="subscribe" onSubmit={onSubmit}>
      <div className="field">
        <input
          type="email"
          name="email"
          required
          placeholder="you@company.com"
          aria-label="Email"
          autoComplete="email"
          // The funnel start: subscribe_start minus subscribe = people who began and left.
          onFocus={() => trackOnce("subscribe_start")}
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Notify me"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" name="beta" /> Also watch the beta channel
      </label>
      <p className="fineprint">
        One confirmation email, then alerts only when Office.js changes. Unsubscribe in one click.{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
    </form>
  );
}
