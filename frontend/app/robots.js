import { SITE_URL } from "@/lib/site";

// Read at request time: SITE_URL comes from the server's .env, not from the build machine.
export const dynamic = "force-dynamic";

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // JSON API, the SSE stream, token links from emails and the uptime probe are not pages.
      disallow: ["/api/", "/confirm", "/unsubscribe", "/health"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
