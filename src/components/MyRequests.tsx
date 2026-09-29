import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";
import type { RequesterTicket, RequesterTicketDetail } from "@/types";
import { ImageDraft, type ImageDraftState } from "./ImageDraft";
import { requestGroups, requesterStatus } from "@/api/requesterPresentation";
import { Conversation } from "./Conversation";

export function MyRequests({ initialSelected = null, pendingImages }: { initialSelected?: string | null; pendingImages?: { ticketId: string; draft: ImageDraftState; retry: () => Promise<boolean> } }) {
  const [tickets, setTickets] = useState<RequesterTicket[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [detail, setDetail] = useState<RequesterTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const focusSelection = useRef(false);
  useEffect(() => {
    if (detail && focusSelection.current) {
      focusSelection.current = false;
      detailHeading.current?.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 768px)').matches) detailHeading.current?.scrollIntoView({ block: 'start' });
    }
  }, [detail]);
  const [sending, setSending] = useState(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      const rows = await api.getMyTickets();
      if (request !== generation.current) return;
      const value = selected && rows.some(t => t.id === selected) ? await api.getMyTicket(selected) : null;
      if (request === generation.current) { setTickets(rows); setDetail(rows.some(t => t.id === selected) ? value : null); if (selected && !rows.some(t => t.id === selected)) setSelected(null); }
    }
    catch (e) { if (request === generation.current) setError((e as Error).message); }
    finally { if (request === generation.current) setLoading(false); }
  }, [selected]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  return <div className="requests">
    <header className="desk-head"><div><p className="label">Your support</p><h1 className="col-title">My requests</h1></div>
      <button className="btn btn-plain btn-sm" disabled={loading || sending} onClick={() => void refresh()}>Refresh</button></header>
    {error ? <p role="alert" className="banner">{error}<button className="btn" onClick={() => void refresh()}>Retry</button></p> : null}
    {loading ? <p role="status">Loading requests…</p> : null}
    <div className="requests-layout"><div className="request-groups">
      {!loading && !tickets.length ? <p className="cardlet">You're all caught up. Requests you send to IT will appear here.</p> : null}
      {requestGroups(tickets).filter(group => group.tickets.length).map(group => <section key={group.id} className={`request-group group-${group.id}`} aria-labelledby={`group-${group.id}`}>
        <header><h2 id={`group-${group.id}`} className="hlabel">{group.title} <span className="group-count">{group.tickets.length}</span></h2>
          <p className="hint">{group.hint}</p></header>
        <ul>{group.tickets.map(t => <li key={t.id}>
          <button className={`request-card${selected === t.id ? ' selected' : ''}`} aria-pressed={selected === t.id} disabled={sending}
            onClick={() => { if (selected !== t.id) { focusSelection.current = true; generation.current++; setDetail(null); setSelected(t.id); } }}>
            <span className="label">{t.reference}</span><span className="request-subject">{t.subject}</span>
            <span className="request-status">{requesterStatus[t.status]}</span>
            <time className="hint" dateTime={t.lastActivityAt ?? t.createdAt}>Last activity {new Date(t.lastActivityAt ?? t.createdAt).toLocaleString()}</time>
            <span className="request-open">Open request →</span>
          </button>
        </li>)}</ul>
      </section>)}
    </div><div className="cardlet request-detail">
      {detail ? <><h2 className="col-title" ref={detailHeading} tabIndex={-1}>{detail.reference}</h2><p className="label">{requesterStatus[detail.status]}</p>
        <p className="said">{detail.description || "No additional description provided."}</p>
        {pendingImages?.ticketId === detail.id ? <section className="reply-callout" aria-label="Retry supporting images">
          <h3 className="hlabel">Your request is with IT. Retry your images here.</h3>
          <ImageDraft draft={pendingImages.draft} disabled={sending} previewsOnly />
          <button className="btn" disabled={sending || !pendingImages.draft.images.length || detail.status === "resolved"} onClick={async () => {
            setSending(true); try { if (await pendingImages.retry()) await refresh(); } finally { setSending(false); }
          }}>Retry attaching images</button>
          {detail.status === "resolved" ? <p className="hint">This request is resolved and can no longer receive images.</p> : null}
        </section> : null}
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
