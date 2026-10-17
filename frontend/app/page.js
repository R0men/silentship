import Scene from "@/components/Scene";
import Subscribe from "@/components/Subscribe";
import Headline from "@/components/Headline";
import ChannelStatus from "@/components/ChannelStatus";
import Rollouts from "@/components/Rollouts";
import JsonLd from "@/components/JsonLd";
import { apiGetOr } from "@/lib/api";
import { website } from "@/lib/jsonLd";
import { pageMeta } from "@/lib/site";

// Data changes every crawl; never prerender at build time. After load, components follow /api/live.
export const dynamic = "force-dynamic";

const TITLE = "silentship — know when Office.js changes on the CDN";

export const metadata = {
  ...pageMeta({
    path: "/",
    title: TITLE,
    description:
      "Live changelog of Office.js on appsforoffice.microsoft.com: new builds, their share of CDN edges, changed host files and API-surface diffs for Excel, Word, Outlook and PowerPoint add-ins.",
  }),
  title: { absolute: TITLE },
};

const JSON_LD = website("Office.js CDN change monitor: builds, rollouts and API-surface diffs.");

export default async function Home() {
  const [overview, list] = await Promise.all([
    apiGetOr("/api/overview", null),
    apiGetOr("/api/rollouts?limit=30", { rollouts: [] }),
  ]);
  const initial = overview ? { overview, rollouts: list.rollouts } : null;

  return (
    <>
      <JsonLd data={JSON_LD} />
      <section className="hero">
        <Scene className="scene" />
        <div className="hero-copy">
          <Headline initial={initial} />
          <Subscribe />
        </div>
        <a className="scroll-cue" href="#status">
          <span aria-hidden="true">↓</span> Live status of both channels
        </a>
      </section>

      <ChannelStatus initial={initial} />

      <Rollouts initial={list.rollouts} initialOverview={overview} />
    </>
  );
}
