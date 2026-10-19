import Link from "next/link";
import Script from "next/script";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ToastProvider } from "@/components/Toast";
import { LiveBadge, LiveProvider } from "@/components/Live";
import { RSS, SITE, SITE_URL } from "@/lib/site";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const DESCRIPTION =
  "Every change Microsoft ships to Office.js on the CDN: build numbers, changed host files and API-surface diffs, checked every 10 minutes.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "silentship — know when Office.js changes on the CDN",
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
                <span className="brand-mark" aria-hidden="true" />
                <span>{SITE.name}</span>
              </Link>
              <nav>
                <LiveBadge />
                <Link href="/#rollouts">Rollouts</Link>
                <Link href="/reference">API changes</Link>
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
                <Link href="/privacy">Privacy</Link>
                <a href={SITE.repo}>GitHub</a>
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
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
