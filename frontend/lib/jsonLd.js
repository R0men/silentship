import { SITE, SITE_URL } from "@/lib/site";

// schema.org builders shared by the pages; components/JsonLd.js renders them.

const CONTEXT = "https://schema.org";
const abs = (path) => `${SITE_URL}${path}`;

export const PUBLISHER = { "@type": "Organization", name: SITE.name, url: abs("/") };

export function website(description) {
  return { "@context": CONTEXT, "@type": "WebSite", name: SITE.name, url: abs("/"), description, publisher: PUBLISHER };
}

/** `items`: [name, path] pairs below the home page, outermost first. */
export function breadcrumbs(items) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: [[SITE.name, "/"], ...items].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: abs(path),
    })),
  };
}

export function techArticle({ path, headline, description, datePublished, dateModified, about, keywords, image }) {
  return {
    "@context": CONTEXT,
    "@type": "TechArticle",
    headline,
    description,
    ...(keywords && { keywords: keywords.join(", ") }),
    ...(image && { image: abs(image) }),
    url: abs(path),
    mainEntityOfPage: abs(path),
    datePublished,
    dateModified: dateModified ?? datePublished,
    about,
    author: PUBLISHER,
    publisher: PUBLISHER,
    isAccessibleForFree: true,
  };
}

/**
 * Office.js (at one build): what a rollout page is about. A plain Thing, not SoftwareApplication: Google
 * reads that as a software-app rich result and rejects it without offers or ratings, which we cannot give.
 */
export function officeJs(build) {
  return {
    "@type": "Thing",
    name: build ? `Office.js ${build}` : "Office.js",
    sameAs: "https://learn.microsoft.com/office/dev/add-ins/",
  };
}

/** A hub page listing other pages; `items`: [name, path]. */
export function collectionPage({ path, name, description, items }) {
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    name,
    description,
    url: abs(path),
    isPartOf: { "@type": "WebSite", name: SITE.name, url: abs("/") },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.map(([itemName, itemPath], i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: itemName,
        url: abs(itemPath),
      })),
    },
  };
}
