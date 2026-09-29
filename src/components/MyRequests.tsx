import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";
import type { RequesterTicket, RequesterTicketDetail } from "@/types";
import { Conversation } from "./Conversation";

export function MyRequests() {
  const [tickets, setTickets] = useState<RequesterTicket[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RequesterTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const [sending, setSending] = useState(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const [rows, value] = await Promise.all([api.getMyTickets(), selected ? api.getMyTicket(selected) : Promise.resolve(null)]);
      if (request === generation.current) { setTickets(rows); setDetail(value); }
    }
    catch (e) { if (request === generation.current) setError((e as Error).message); }
    finally { if (request === generation.current) setLoading(false); }
  }, [selected]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  return <div className="requests">
    <header className="desk-head"><div><p className="label">Your support</p><h1 className="col-title">My requests</h1></div>
      <button className="btn" disabled={loading || sending} onClick={() => void refresh()}>Refresh requests</button></header>
    {error ? <p role="alert" className="banner">{error}<button className="btn" onClick={() => void refresh()}>Retry</button></p> : null}
    {loading ? <p role="status">Loading requests…</p> : null}
    <div className="desk-body"><div className="cardlet">
      {!loading && !tickets.length ? <p>No requests yet. Send an unresolved issue to IT to start one.</p> : null}
      <ul className="routes">{tickets.map((t) => <li key={t.id}>
        <button className="btn btn-plain" aria-pressed={selected === t.id} disabled={sending} onClick={() => { if (selected !== t.id) { generation.current++; setDetail(null); setSelected(t.id); } }}>{t.reference} · {t.subject}</button>
        <span className="meta">{t.status.replaceAll("_", " ")} · {new Date(t.createdAt).toLocaleString()}</span>
      </li>)}</ul>
    </div><div className="cardlet">
      {detail ? <><h2 className="col-title">{detail.reference}</h2><p className="label">{detail.status.replaceAll("_", " ")}</p>
        <p className="said">{detail.description || "No additional description provided."}</p>
        <Conversation ticketId={detail.id} key={detail.id} disabled={loading} messages={detail.messages} resolved={detail.status === "resolved"} onSend={async (body, _wait, images) => {
          setSending(true);
          try { await api.sendTicketMessage(detail.id, body, false, images); await refresh(); return true; }
          catch (e) { setError((e as Error).message); return false; }
          finally { setSending(false); }
        }} />
      </> : <p className="hint">Select a request to read and reply to IT.</p>}
    </div></div>
  </div>;
}
