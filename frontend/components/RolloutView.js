"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { typeHref } from "@/lib/apiType";
import { apiStatusLabel, hostLabel, KIND_LABEL, pct, STATUS_LABEL } from "@/lib/format";
import { Segmented, Severity, ShareBar, Sparkline } from "./ui";

function HostChips({ files }) {
  const names = files.map(hostLabel);
  return (
    <div className="hosts">
      {names.slice(0, 4).map((n) => (
        <span key={n} className="host">
          {n}
        </span>
      ))}
      {names.length > 4 && (
        <span className="host" title={names.slice(4).join(", ")}>
          +{names.length - 4}
        </span>
      )}
    </div>
  );
}

function HostsTable({ hosts }) {
  return (
    <div className="table hosts-table">
      <div className="tr th">
        <div>File</div>
        <div>Change</div>
        <div>Edges on new version</div>
        <div>Last runs</div>
        <div>Severity</div>
      </div>
      {hosts.map((h) => (
        <div className="tr" key={h.path}>
          <div>
            <div className="path">{h.path}</div>
            <div className="detail">
              {h.added ? "new file" : h.removed ? "file removed" : `${h.fromBuild ?? "?"} → ${h.toBuild ?? "?"}`}
            </div>
          </div>
          <div className="muted">
            {STATUS_LABEL[h.status]}
            {h.apiChangeCount > 0 && <div className="faint">{h.apiChangeCount} API changes</div>}
          </div>
          <div className="share-cell">
            <b>{pct(h.share)}</b>
            <ShareBar share={h.share} status={h.status} />
          </div>
          <div>
            <Sparkline points={h.history} />
          </div>
          <div>
            <Severity value={h.severity} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RolloutView({ rollout }) {
  const [tab, setTab] = useState(rollout.apiChanges.length ? "api" : "hosts");
  const [severity, setSeverity] = useState("all");
  const [query, setQuery] = useState("");

  const changes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollout.apiChanges.filter(
      (c) => (severity === "all" || c.severity === severity) && (!q || c.path.toLowerCase().includes(q)),
    );
  }, [rollout.apiChanges, severity, query]);

  return (
    <>
      <div className="tabs">
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            ["api", `API changes ${rollout.apiChanges.length}`],
            ["hosts", `Files ${rollout.hosts.length}`],
          ]}
        />
        {tab === "api" && (
          <div className="filters">
            <Segmented
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={[
                ["all", "All"],
                ["high", "High"],
                ["medium", "Medium"],
                ["low", "Low"],
              ]}
            />
            <input
              className="search"
              type="search"
              placeholder="Filter, e.g. Excel.Range"
              aria-label="Filter API changes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* The visible label is the tab (a button), which cannot hold a heading. */}
      <h2 className="sr-only">{tab === "hosts" ? `Files (${rollout.hosts.length})` : `API changes (${rollout.apiChanges.length})`}</h2>
      {tab === "hosts" ? (
        <HostsTable hosts={rollout.hosts} />
      ) : changes.length ? (
        <div className="table">
          <div className="tr th">
            <div>API</div>
            <div>Change</div>
            <div>Severity</div>
            <div>Files</div>
          </div>
          {changes.map((c) => (
            <div className="tr" key={`${c.path}:${c.kind}`}>
              <div>
                <Link className="path" href={typeHref(c.type, c.path)}>
                  {c.path}
                </Link>
                <div className="detail">
                  {c.kind === "renamed" && c.from && <span>from {c.from.split(".").pop()} </span>}
                  {c.detail && <span>{c.detail} </span>}
                  {apiStatusLabel(c) && (
                    <span className={`api-status api-${c.apiStatus ?? "ga"}`}>{apiStatusLabel(c)}</span>
                  )}
                </div>
              </div>
              <div className="muted">{KIND_LABEL[c.kind] ?? c.kind}</div>
              <div>
                <Severity value={c.severity} />
              </div>
              <HostChips files={c.files} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <b>No public API changes{rollout.apiChanges.length ? " match the filter" : ""}.</b>
          {!rollout.apiChanges.length && " The new build changes code, but not the API surface we can see."}
        </div>
      )}
    </>
  );
}
