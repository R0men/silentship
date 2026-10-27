/** Product name and operator details shown on pages and legal text. Fill in the operator before launch. */
export const SITE = {
  name: "silentship",
  domain: "silentship.dev",
  // Who is responsible for the data (GDPR "controller"): a person's or company's legal name and address.
  operator: "the operator of silentship",
  // Data-protection requests, on /privacy only.
  privacyEmail: "privacy@silentship.dev",
  // Everything else: the footer, replies to emails.
  contactEmail: "hello@silentship.dev",
  repo: "https://github.com/R0men/silentship",
  // Optional support link; kept quiet in the footer and emails.
  support: "https://ko-fi.com/silentship",
  updated: "2026-10-27",
};

/**
 * Absolute origin for canonical URLs, Open Graph and the sitemap. Server-only: PUBLIC_URL comes from the
 * root .env (loaded in next.config.mjs) and is not exposed to client components.
 */
export const SITE_URL = (process.env.PUBLIC_URL || `https://${SITE.domain}`).replace(/\/$/, "");

export const RSS = { "application/rss+xml": [{ url: "/rss.xml", title: "silentship — Office.js CDN rollouts" }] };

/** The notes feed (app/notes/rss.xml), announced on /notes next to the rollouts feed. */
export const NOTES_RSS = {
  "application/rss+xml": [...RSS["application/rss+xml"], { url: "/notes/rss.xml", title: "silentship — notes" }],
};

/** The shared preview rendered by app/opengraph-image.js (same size and alt). */
const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "silentship — know when Office.js changes on the CDN",
};

/**
 * Per-page metadata. Next merges metadata shallowly, so a page that sets `alternates` or `openGraph`
 * replaces the layout's whole object — including the file-based opengraph-image of the root segment, which
 * then reaches only the home page. This builds all of it complete for one path.
 */
export function pageMeta({ path, title, description, type = "website", image = OG_IMAGE, article, keywords, rss = RSS }) {
  return {
    title,
    description,
    ...(keywords && { keywords }),
    alternates: { canonical: path, types: rss },
    openGraph: {
      type,
      siteName: SITE.name,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [image],
      // og:article:published_time, modified_time and tag; only for type "article".
      ...article,
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/** The note that explains how the two CDN endpoints differ; linked from rollout pages. */
export const ENDPOINTS_NOTE = "/notes/new-office-js-cdn-endpoint";
