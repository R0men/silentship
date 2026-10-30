import Link from "next/link";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import { LiveBadge, LiveProvider } from "@/components/Live";
import SectionLink from "@/components/SectionLink";
import { RSS, SITE, SITE_URL } from "@/lib/site";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const DESCRIPTION =
  "Every change Microsoft ships to Office.js on the CDN: build numbers, changed host files and API-surface diffs, checked every 10 minutes.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Office.js changelog: live CDN builds and API changes — silentship",
    template: "%s — silentship",
  },
  description: DESCRIPTION,
  applicationName: SITE.name,
  keywords: ["Office.js", "Office Add-ins", "Office.js CDN", "Office.js changelog", "appsforoffice", "OneCDN", "Excel API", "Outlook add-in"],
  alternates: { types: RSS },
  openGraph: { type: "website", siteName: SITE.name, locale: "en_US", url: "/", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
};

export const viewport = { themeColor: "#060607" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <LiveProvider>
          <ToastProvider>
            <header className="nav">
              <Link className="brand" href="/">
                {/* The arrow of app/icon.svg, without its tile. */}
                <svg className="brand-mark" viewBox="7 8 18 16" aria-hidden="true">
                  <path
                    d="M9 21.5 14 10l3.2 7.4L19.5 13 23 21.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{SITE.name}</span>
              </Link>
              <nav>
                <LiveBadge />
                <SectionLink id="rollouts">Rollouts</SectionLink>
                <Link href="/reference">API changes</Link>
                <Link href="/notes">Notes</Link>
                <a className="nav-rss" href="/rss.xml">
                  RSS
                </a>
              </nav>
            </header>
            <main>{children}</main>
            <footer className="footer">
              <p>
                Watches the JavaScript layer served from both endpoints: <span className="mono">appsforoffice.microsoft.com</span>{" "}
                (legacy) and <span className="mono">officeapis.public.onecdn.static.microsoft</span>. Breakages inside
                native hosts (Outlook, Excel win32, …) are not visible here.
              </p>
              <p>Not affiliated with Microsoft. Metadata and API-surface diffs only — no Microsoft code.</p>
              <p className="footer-links">
                <Link href="/notes">Notes</Link>
                <a href={SITE.repo} rel="noopener">
                  GitHub
                </a>
                <a href={`mailto:${SITE.contactEmail}`} title={SITE.contactEmail}>
                  Contact
                </a>
                <a href={SITE.support} rel="noopener">
                  Support on Ko-fi
                </a>
                {/* noindex page: no link equity from every page of the site. */}
                <Link href="/privacy" rel="nofollow">
                  Privacy
                </Link>
              </p>
            </footer>
          </ToastProvider>
        </LiveProvider>
        {/* Production only, and only counted on the real domain, so localhost visits stay out of the stats. */}
        {process.env.NODE_ENV === "production" && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id="29a30a96-2622-42a7-882e-e79df1ced944"
            data-domains={SITE.domain}
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
