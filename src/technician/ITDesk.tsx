import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueStats, SavedRoute, TicketRow } from "@/types";
import { api } from "@/api";
import { TicketPanel } from "./TicketPanel";

const STATUS_LABEL: Record<string, string> = {
  new: "New", assigned: "Assigned", waiting: "Waiting",
  needs_review: "Needs review", resolved: "Resolved",
};
const PRIORITY_LABEL: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function relativeAge(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h` : `${Math.round(hrs / 24)}d`;
}

export function ITDesk({
  flash, onError, currentUserId,
}: {
  currentUserId: string;
  flash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const [filter, setFilter] = useState("all");
  const closePanel = useCallback(() => setOpenId(null), []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [t, s, r] = await Promise.all([api.getTickets(), api.getStats(), api.getRoutes()]);
      if (request !== generation.current) return;
      setTickets(t); setStats(s); setRoutes(r);
    } catch {
      if (request === generation.current) setLoadError(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);

  if (loadError) return <div className="empty" role="alert">
    <p>We couldn't load the support queue. Try again.</p>
    <button className="btn" onClick={() => void refresh()}>Retry</button>
  </div>;
  if (!tickets || !stats) return <div className="loading" role="status">Loading the queue…</div>;

  const filters = [
    { id: "all", label: "All", rows: tickets },
    { id: "mine", label: "Assigned to me", rows: tickets.filter(t => t.assigneeId === currentUserId) },
    { id: "unassigned", label: "Unassigned", rows: tickets.filter(t => !t.assigneeId && t.status !== "resolved") },
    { id: "needs_review", label: "Needs review", rows: tickets.filter(t => t.status === "needs_review") },
    { id: "waiting", label: "Waiting", rows: tickets.filter(t => t.status === "waiting") },
  ];
  const ordered = [...(filters.find(f => f.id === filter)?.rows ?? tickets)].sort((a, b) =>
    Number(a.status === "resolved") - Number(b.status === "resolved") ||
    Number(b.status === "needs_review") - Number(a.status === "needs_review") ||
    (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const tiles: [string, string | number][] = [
    ["Open", stats.open],
    ["Needs review", stats.needsReview],
    ["Resolved today", stats.resolvedToday],
    ["Avg. resolution", `${stats.avgResolutionMinutes}m`],
  ];

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <p className="label">IT desk</p>
          <h1 className="col-title">Every ticket arrives with the questions already answered.</h1>
        </div>
        <div className="tiles">
          {tiles.map(([k, v]) => (
            <div className="tile" key={k}>
              <span className="tile-v">{v}</span>
              <span className="tile-k">{k}</span>
            </div>
          ))}
        </div>
      </header>

      <button className="btn" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh queue"}</button>
      <div className="row queue-filters" role="group" aria-label="Filter queue">{filters.map(f =>
        <button key={f.id} className="btn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} ({f.rows.length})</button>)}</div>
      <div className="desk-body">
        <div className="tablecard">
          {ordered.length === 0 ? (
            <div className="empty">
              <p className="said">Nothing waiting.</p>
              <p className="hint">New requests land here the moment somebody sends one.</p>
            </div>
          ) : (
            <>
              <table className="queue queue-desktop">
                <thead>
                  <tr>
                    <th>Requester</th><th>Issue</th><th>Assessment</th>
                    <th>Priority</th><th>Status</th><th className="r">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((t) => (
                    <tr
                      key={t.id}
                      className={openId === t.id ? "on" : ""}
                      onClick={() => setOpenId(t.id)}
                    >
                      <td>
                        <button className="btn btn-plain" aria-label={`Open ${t.reference} from ${t.requester}`} onClick={() => setOpenId(t.id)}>{t.requester}</button>
                        <span className="ref-sm">{t.reference}</span>
                      </td>
                      <td>{t.categoryShort}</td>
                      <td className="assess">{t.diagnosisLabel ?? "—"}</td>
                      <td><span className={`pri pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span></td>
                      <td><span className={`stat stat-${t.status}`}>{STATUS_LABEL[t.status]}</span></td>
                      <td className="r muted">{relativeAge(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="queue-mobile" aria-label="Support queue">
                {ordered.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={`queue-card${openId === t.id ? " on" : ""}`}
                    onClick={() => setOpenId(t.id)}
                  >
                    <span className="queue-card-top">
                      <span>
                        <span className="who">{t.requester}</span>
                        <span className="ref-sm">{t.reference} · {relativeAge(t.createdAt)}</span>
                      </span>
                      <span className={`pri pri-${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
                    </span>
                    <span className="queue-card-assessment">
                      <span>{t.categoryShort}</span>
                      <span className="assess">{t.diagnosisLabel ?? "Needs triage"}</span>
                    </span>
                    <span className={`stat stat-${t.status}`}>{STATUS_LABEL[t.status]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="cardlet">
          <p className="label">Path Library</p>
          <p className="hint">Diagnostic paths the team has kept for quick reference. They do not change the live questions automatically.</p>
          {!routes.length ? <p className="hint">No paths saved yet. Open a ticket to save its diagnostic path.</p> : null}
          <ul className="routes">
            {routes.map((r) => (
              <li key={r.id}>
                <details><summary className="route-name">{r.name}</summary>
                  <p>{r.category} · {r.diagnosis}</p>
                  <ol>{r.path.map((p, i) => <li key={i}>{p.question}<br /><strong>{p.answer}</strong></li>)}</ol>
                  <p className="hlabel">Troubleshooting attempts</p>
                  {r.attempts.length ? <ul>{r.attempts.map((a, i) => <li key={i}>{a.title} · {a.outcome}</li>)}</ul> : <p className="hint">No attempts recorded.</p>}
                  <p className="meta">Saved by {r.savedBy} · {new Date(r.savedAt).toLocaleString()}</p>
                </details>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {openId ? (
        <TicketPanel
          ticketId={openId}
          onClose={closePanel}
          onChanged={refresh}
          flash={flash}
          onError={onError}
        />
      ) : null}
    </div>
  );
}
