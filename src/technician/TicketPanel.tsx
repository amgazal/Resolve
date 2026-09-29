import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketDetail } from "@/types";
import { api } from "@/api";
import { Icon } from "@/components/Icon";
import { Conversation } from "@/components/Conversation";
import { Trail } from "@/components/Trail";

export function TicketPanel({
  ticketId, onClose, onChanged, flash, onError,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  flash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const actionLock = useRef(false);
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoadError(null);
    await api.getTicket(ticketId)
      .then((value) => { if (mounted.current && generation === loadGeneration.current) setTicket(value); })
      .catch((e: Error) => {
        if (!mounted.current || generation !== loadGeneration.current) return;
        setTicket(null);
        setLoadError(e.message);
        onError(e.message);
      });
  }, [ticketId, onError]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadGeneration.current++; }; }, [load]);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));

      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [onClose]);

  async function act(fn: () => Promise<unknown>, msg: string): Promise<boolean> {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      flash(msg);
      await Promise.all([load(), onChanged()]);
      return true;
    } catch (e) {
      setActionError((e as Error).message);
      return false;
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function submitNote() {
    const body = noteDraft.trim();
    if (!body || busy || !ticket) return;
    const added = await act(() => api.addNote(ticket.id, body), "Note added");
    if (added) setNoteDraft("");
  }

  return (
    <>
      <div className="veil" onClick={onClose} aria-hidden="true" />
      <section ref={panelRef} className="panel" role="dialog" aria-modal="true" aria-labelledby="ticket-panel-title">
        <header className="panel-head">
          <div>
            <p className="label">
              {ticket ? `${ticket.reference} · ${ticket.categoryLabel} · from ${ticket.requester}` : "IT desk · Ticket detail"}
            </p>
            <h2 id="ticket-panel-title" className="col-title panel-title">
              {ticket?.subject ?? (loadError ? "This ticket could not be opened." : "Opening ticket…")}
            </h2>
            {ticket ? <p className="ticket-workflow" role="status"><span className={`badge status-${ticket.status}`}>{ticket.status.replaceAll("_", " ")}</span> · {ticket.assignee ?? "Unassigned"}{ticket.status === "waiting" ? " · IT is waiting on the requester" : ticket.status === "needs_review" ? " · Requester replied; IT needs to review" : ""}</p> : null}
          </div>
          <button ref={closeRef} className="btn btn-plain btn-sm" onClick={onClose} aria-label="Close ticket detail">
            <Icon name="close" size={15} />
          </button>
        </header>

        {actionError ? <p className="banner" role="alert">{actionError}</p> : null}
        {!ticket ? (
          <div className="panel-loading" role="status">
            <p className="said">{loadError ? "We couldn't load this ticket." : "Getting the diagnostic history…"}</p>
            <p className="hint">{loadError ?? "This should only take a moment."}</p>
            {loadError ? <button className="btn" onClick={load}>Try again</button> : null}
          </div>
        ) : (
          <div className="panel-body" tabIndex={0} role="region" aria-label="Ticket content">
          <div className="panel-main">
            <div className="panel-next-action"><p className="hlabel">Next action</p><p>{ticket.status === "resolved" ? "Resolved · retained for reference." : ticket.status === "waiting" ? "Waiting on the requester. Resume work when you are ready to continue." : ticket.status === "needs_review" ? "Review the requester’s reply, then continue troubleshooting or resolve the request." : !ticket.assigneeId ? "Assign this request before taking ownership of the next step." : "Review the findings and attempted steps, then reply to the requester."}</p>
              {ticket.messages.filter(m => m.senderKind === "requester").length ? <p className="hint">Latest requester reply · {new Date(ticket.messages.filter(m => m.senderKind === "requester").at(-1)!.createdAt).toLocaleString()}</p> : null}
            </div>
            <section>
              <p className="hlabel">In their words</p>
              <p className="said">{ticket.description || "No additional description provided."}</p>
              {ticket.userNote ? <p className="meta">Added note — {ticket.userNote}</p> : null}
            </section>

            <section>
              <p className="hlabel">Confirmed</p>
              {!ticket.facts.length ? <p className="hint">No diagnostic facts recorded.</p> : null}
              <dl className="facts">
                {ticket.facts.map((f, i) => (
                  <div className="fact" key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
                ))}
              </dl>
            </section>

            <section>
              <p className="hlabel">Already tried</p>
              <ul className="checks">
                {ticket.attempts.length
                  ? ticket.attempts.map((a, i) => <li key={i}>{a.title}</li>)
                  : <li className="muted">No troubleshooting steps recorded.</li>}
              </ul>
            </section>

            <Conversation ticketId={ticket.id} messages={ticket.messages} resolved={ticket.status === "resolved"} staff disabled={busy} requester={ticket.requester} status={ticket.status} unassigned={!ticket.assigneeId}
              onSend={(body, wait, images) => act(() => api.sendTicketMessage(ticket.id, body, wait, images), wait ? "Sent · waiting for requester." : "Message sent.")} />
            <button className="btn" disabled={busy} onClick={() => void Promise.all([load(), onChanged()])}>Refresh conversation</button>

            <section>
              <p className="hlabel">Internal notes · IT only</p>
              {ticket.notes.length ? (
                <ul className="notes">
                  {ticket.notes.map((n, i) => (
                    <li key={i}><span className="who">{n.author}</span><time className="hint" dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString()}</time><p>{n.body}</p></li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Nothing yet. Notes stay on this side — the requester never sees them.</p>
              )}
              <div className="noterow">
                <textarea
                  rows={3}
                  disabled={busy}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add an internal note"
                  aria-label="Add an internal note"
                  maxLength={2000}
                />
                <button
                  className="btn"
                  disabled={busy || !noteDraft.trim()}
                  onClick={() => void submitNote()}
                >
                  Add
                </button>
              </div>
            </section>
          </div>

          <div className="panel-side">
            <div className="cardlet">
              <p className="label">How they got here</p>
              <Trail nodes={ticket.path} />
            </div>

            <div className="cardlet">
              <p className="label">Context</p>
              <dl className="facts">
                <div className="fact"><dt>Device</dt><dd>{ticket.device ?? "—"}</dd></div>
                <div className="fact"><dt>System</dt><dd>{ticket.operatingSystem ?? "—"}</dd></div>
                <div className="fact"><dt>Assigned</dt><dd>{ticket.assignee ?? "Nobody yet"}</dd></div>
              </dl>
            </div>

            <div className="actions">
              {ticket.status !== "resolved" ? <>
              <button
                className="btn" disabled={busy || Boolean(ticket.assignee)}
                onClick={() => act(
                  () => api.updateTicket(ticket.id, { assignToMe: true, status: "assigned" }),
                  "Assigned to you")}
              >
                Assign to me
              </button>
              {ticket.status === "waiting" && ticket.assignee ? <button className="btn" disabled={busy}
                onClick={() => act(() => api.updateTicket(ticket.id, { status: "assigned" }), "Work resumed")}>Resume work</button> : null}
              <button
                className="btn btn-primary" disabled={busy}
                onClick={() => act(
                  () => api.updateTicket(ticket.id, { status: "resolved" }),
                  "Marked resolved")}
              >
                Mark resolved
              </button>
              </> : <p role="status">Resolved</p>}
              <button
                className="btn btn-plain" disabled={busy}
                onClick={() => act(() => api.saveRoute(ticket.id), "Saved to Path Library")}
              >
                Save to Path Library
              </button>
            </div>
          </div>
          </div>
        )}
      </section>
    </>
  );
}
