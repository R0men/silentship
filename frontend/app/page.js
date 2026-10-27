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

const TITLE = "Office.js changelog: live CDN builds and API changes — silentship";

export const metadata = {
  ...pageMeta({
    path: "/",
    title: TITLE,
    description:
      "Live changelog of Office.js on both CDN endpoints, legacy appsforoffice.microsoft.com and officeapis.public.onecdn.static.microsoft: new builds, their share of edges, changed host files and API-surface diffs.",
  }),
  title: { absolute: TITLE },
};

const JSON_LD = website("Office.js CDN change monitor: builds, rollouts and API-surface diffs.");

export default async function Home() {
  // One snapshot for the headline, the cards and the list: the same one /api/live pushes afterwards.
  const initial = await apiGetOr("/api/home", null);

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

      <Rollouts initial={initial} />
    </>
  );
}
