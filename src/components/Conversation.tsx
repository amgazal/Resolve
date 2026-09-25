import { useRef, useState } from "react";
import type { TicketMessage } from "@/types";

export function Conversation({ messages, resolved, staff = false, disabled = false, requester, onSend }: {
  messages: TicketMessage[]; resolved: boolean; staff?: boolean; disabled?: boolean; requester?: string;
  onSend: (body: string, wait: boolean) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function send(wait: boolean) {
    if (lock.current || !draft.trim()) return;
    lock.current = true; setBusy(true);
    try { if (await onSend(draft, wait)) setDraft(""); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="Conversation">
    <h2 className="hlabel">Conversation with {staff ? requester ?? "requester" : "IT"}</h2>
    <p className="hint">Messages are shared with the requester and IT. Refresh to check for replies.</p>
    {messages.length ? <ul className="notes">{messages.map((m) => <li key={m.id}>
      <span className="who">{m.author} · {m.senderKind === "staff" ? "IT" : "Requester"}</span>
      <time className="hint" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
      <p>{m.body}</p>
    </li>)}</ul> : <p className="hint">No messages yet.</p>}
    {resolved ? <p className="hint">This request is resolved. Start a new request if you need more help.</p> : <>
      <label className="field"><span className="label">Message</span>
        <textarea rows={3} maxLength={4000} value={draft} disabled={disabled || busy} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn btn-primary" disabled={disabled || busy || !draft.trim()} onClick={() => void send(false)}>Send message</button>
        {staff ? <button className="btn" disabled={disabled || busy || !draft.trim()} onClick={() => void send(true)}>Send &amp; wait for reply</button> : null}
      </div>
    </>}
  </section>;
}
