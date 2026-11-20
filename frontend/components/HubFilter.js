"use client";

import { useState } from "react";
import { Segmented } from "./ui";

/**
 * "All changes" (default) / "Documented only" on the /reference hub. Every row stays in the HTML (crawlers and no-JS readers see the
 * full list); the filter only hides undocumented rows with CSS (`.hub[data-show="documented"]`).
 */
export default function HubFilter({ documented, all, children }) {
  const [show, setShow] = useState("all");
  return (
    <div className="hub" data-show={show}>
      <div className="hub-filter">
        <Segmented
          label="Which APIs"
          value={show}
          onChange={setShow}
          options={[
            ["all", `All changes (${all} types)`],
            ["documented", `Documented only (${documented})`],
          ]}
        />
      </div>
      {children}
    </div>
  );
}
