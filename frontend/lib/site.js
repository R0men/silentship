/** Product name and operator details shown on pages and legal text. Fill in the operator before launch. */
export const SITE = {
  name: "silentship",
  domain: "silentship.dev",
  // Who is responsible for the data (GDPR "controller"): a person's or company's legal name and address.
  operator: "the operator of silentship",
  contactEmail: "privacy@silentship.dev",
  updated: "2026-10-17",
};

/**
 * Absolute origin for canonical URLs, Open Graph and the sitemap. Server-only: PUBLIC_URL comes from the
 * root .env (loaded in next.config.mjs) and is not exposed to client components.
 */
export const SITE_URL = (process.env.PUBLIC_URL || `https://${SITE.domain}`).replace(/\/$/, "");

export const RSS = { "application/rss+xml": [{ url: "/rss.xml", title: "silentship — Office.js CDN rollouts" }] };

/**
 * Per-page metadata. Next merges metadata shallowly, so a page that sets `alternates` or `openGraph`
 * replaces the layout's whole object; this builds both complete for one path.
 */
export function pageMeta({ path, title, description, type = "website" }) {
  return {
    title,
    description,
    alternates: { canonical: path, types: RSS },
    openGraph: { type, siteName: SITE.name, locale: "en_US", url: path, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}
