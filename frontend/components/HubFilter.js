"use client";

import { useEffect, useState } from "react";
import { plural } from "@/lib/format";
import { Segmented } from "./ui";

/** A filter value goes into a CSS selector and the URL hash: application names are plain words. */
const SAFE = /^\w+$/;

/**
 * Two filters on the /reference hub: the application ("All apps", Excel, Word, …, "Common API") and
 * "All changes" / "Documented only". Every row stays in the HTML (crawlers and no-JS readers see the full list);
 * the filters only hide rows with CSS: `.hub[data-show="documented"]` in globals.css, and the per-application
 * rules below, which show only the elements marked for the chosen application (`data-app`, `data-apps`,
 * `data-for`). The application is kept in the URL hash (`/reference#excel`) so a filtered view can be shared.
 *
 * `apps`: `[app, label, { all, documented }]` in display order; `counts`: the same counts across every app.
 */
export default function HubFilter({ apps, counts, children }) {
  const [show, setShow] = useState("all");
  const [app, setApp] = useState("all");

  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
      const hit = apps.find(([a]) => a.toLowerCase() === h);
      setApp(hit ? hit[0] : "all");
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [apps]);

  const pick = (a) => {
    setApp(a);
    const url = a === "all" ? window.location.pathname + window.location.search : `#${a.toLowerCase()}`;
    window.history.replaceState(null, "", url);
  };

  const current = app === "all" ? counts : (apps.find(([a]) => a === app)?.[2] ?? counts);
  const sel = SAFE.test(app) ? app : "all";
  const css =
    sel === "all"
      ? `.hub [data-for]:not([data-for="all"]){display:none}`
      : `.hub [data-app]:not([data-app="${sel}"]),` +
        `.hub [data-apps]:not([data-apps~="${sel}"]),` +
        `.hub [data-for]:not([data-for="${sel}"]){display:none}`;

  return (
    <div className="hub" data-show={show}>
      <style>{css}</style>
      <div className="hub-filter">
        <Segmented
          label="Application"
          value={app}
          onChange={pick}
          options={[["all", "All apps"], ...apps.map(([a, label]) => [a, label])]}
        />
        <Segmented
          label="Which APIs"
          value={show}
          onChange={setShow}
          options={[
            ["all", `All changes (${plural(current.all, "type")})`],
            ["documented", `Documented only (${current.documented})`],
          ]}
        />
      </div>
      {children}
    </div>
  );
}
