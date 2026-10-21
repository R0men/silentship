import Link from "next/link";
import { pageMeta, SITE } from "@/lib/site";

export const metadata = {
  ...pageMeta({
    path: "/privacy",
    title: "Privacy policy",
    description: "What silentship collects, why, who processes it and how to get it deleted.",
  }),
  // Legal boilerplate, not a search result; links from it are still followed.
  robots: { index: false, follow: true },
};

export default function Privacy() {
  return (
    <article className="prose">
      <Link className="back" href="/">
        ← Home
      </Link>
      <h1>Privacy policy</h1>
      <p className="muted">Last updated {SITE.updated}</p>

      <p>
        {SITE.name} monitors the public Office.js CDN and emails subscribers when Microsoft rolls out changes. This page
        explains the little personal data that involves. The service is run by {SITE.operator}, who is responsible for
        it. Questions or requests: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Your email address</b>, when you subscribe, plus your choices: channels (production, beta), minimum
          severity and the APIs on your watchlist.
        </li>
        <li>
          <b>Timestamps</b> of when you subscribed, confirmed and unsubscribed, and when we sent confirmation emails (so
          nobody can flood your inbox through our form).
        </li>
        <li>
          <b>Your IP address</b>, for a short time in server memory to rate-limit the subscription form, and in server
          logs used to keep the service running.
        </li>
      </ul>
      <p>
        <b>Anonymous visit statistics</b> through Umami: which pages are opened, a few anonymous
        interactions on them (opening a rollout, starting the sign-up form), the referring site, browser, device
        type and country. Umami sets no cookies and stores no IP addresses or other personal data, so a visit cannot be
        traced back to you. We do not use advertising or tracking cookies; the site sets no cookies at all. Pages you
        open here are not linked to your email address.
      </p>

      <h2>Why</h2>
      <ul>
        <li>
          To send the alerts you asked for, and the one-time confirmation email (your consent; you can withdraw it).
        </li>
        <li>To protect the service and other people from abuse of the subscription form (legitimate interest).</li>
      </ul>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <b>Brevo</b> (France) delivers our emails and therefore receives your address and the email content.
        </li>
        <li>
          <b>Umami</b> (Umami Software, Inc.) hosts the anonymous visit statistics described above.
        </li>
        <li>Our database and server hosting providers store the data listed above on our behalf.</li>
      </ul>
      <p>We do not sell or share your data with anyone else.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Unconfirmed sign-ups are deleted automatically after 30 days.</li>
        <li>
          Confirmed subscriptions are kept until you unsubscribe. Every alert has a one-click unsubscribe link; after
          that you receive nothing. To have the record erased entirely, email us.
        </li>
        <li>Server logs are rotated and kept for a limited time.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the GDPR), you can ask to access, correct, export or delete your
        data, object to its processing, and complain to a data protection authority. Email{" "}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will reply within 30 days.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that matters, we will tell subscribers by email before it applies.</p>
    </article>
  );
}
