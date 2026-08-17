import { useCallback, useEffect, useRef, useState } from "react";
import type { TicketDetail } from "@/types";
import { api } from "@/api";
import { Icon } from "@/components/Icon";
import { Trail } from "@/components/Trail";

export function TicketPanel({
  ticketId, onClose, onChanged, flash, onError,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
  flash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.getTicket(ticketId)
      .then(setTicket)
      .catch((e: Error) => {
        setLoadError(e.message);
        onError(e.message);
      });
  }, [ticketId, onError]);

  useEffect(() => { load(); }, [load]);

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
    setBusy(true);
    try {
      await fn();
      flash(msg);
      load();
      onChanged();
      return true;
    } catch (e) {
      onError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
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
          </div>
          <button ref={closeRef} className="btn btn-plain btn-sm" onClick={onClose} aria-label="Close ticket detail">
            <Icon name="close" size={15} />
          </button>
        </header>

        {!ticket ? (
          <div className="panel-loading" role="status">
            <p className="said">{loadError ? "We couldn't load this ticket." : "Getting the diagnostic history…"}</p>
            <p className="hint">{loadError ?? "This should only take a moment."}</p>
            {loadError ? <button className="btn" onClick={load}>Try again</button> : null}
          </div>
        ) : (
          <div className="panel-body">
          <div className="panel-main">
            <section>
              <p className="hlabel">In their words</p>
              <p className="said">{ticket.description}</p>
              {ticket.userNote ? <p className="meta">Added note — {ticket.userNote}</p> : null}
            </section>

            <section>
              <p className="hlabel">Confirmed</p>
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
                  : <li className="muted">Nothing yet</li>}
              </ul>
            </section>

            <section>
              <p className="hlabel">Internal notes</p>
              {ticket.notes.length ? (
                <ul className="notes">
                  {ticket.notes.map((n, i) => (
                    <li key={i}><span className="who">{n.author}</span>{n.body}</li>
                  ))}
                </ul>
              ) : (
                <p className="hint">Nothing yet. Notes stay on this side — the requester never sees them.</p>
              )}
              <div className="noterow">
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Add an internal note"
                  aria-label="Add an internal note"
                  maxLength={2000}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !busy && noteDraft.trim()) {
                      e.preventDefault();
                      void submitNote();
                    }
                  }}
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
              <button
                className="btn" disabled={busy || Boolean(ticket.assignee)}
                onClick={() => act(
                  () => api.updateTicket(ticket.id, { assignToMe: true, status: "assigned" }),
                  "Assigned to you")}
              >
                Assign to me
              </button>
              <button
                className="btn" disabled={busy}
                onClick={() => act(
                  () => api.updateTicket(ticket.id, { status: "waiting" }),
                  `Marked as waiting for ${ticket.requester.split(" ")[0]}`)}
              >
                Mark waiting for user
              </button>
              <button
                className="btn btn-primary" disabled={busy || ticket.status === "resolved"}
                onClick={() => act(
                  () => api.updateTicket(ticket.id, { status: "resolved" }),
                  "Marked resolved")}
              >
                Mark resolved
              </button>
              <button
                className="btn btn-plain" disabled={busy}
                onClick={() => act(() => api.saveRoute(ticket.id), "Diagnostic path saved")}
              >
                Save diagnostic path
              </button>
            </div>
          </div>
          </div>
        )}
      </section>
    </>
  );
}
