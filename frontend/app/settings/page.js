import Link from "next/link";
import Settings from "@/components/Settings";
import { pageMeta } from "@/lib/site";

export const metadata = {
  ...pageMeta({
    path: "/settings",
    title: "Alert settings",
    description: "Choose which Office.js channels, severities and APIs your silentship alerts cover.",
  }),
  // Personal page reached from an email; nothing here for search engines.
  robots: { index: false, follow: false },
  // The token is in the URL fragment, which is never sent anyway; this also keeps the path out of Referer.
  referrer: "no-referrer",
};

/**
 * Alert settings for one subscriber. Static: the token comes in the fragment (`/settings#token=…`, from the
 * links in every email), so the page reads it in the browser and talks to /api/settings.
 */
export default function SettingsPage() {
  return (
    <article className="prose settings">
      <Link className="back" href="/">
        ← Home
      </Link>
      <h1>Alert settings</h1>
      <Settings />
    </article>
  );
}
