import { useEffect, useRef, useState } from "react";
import { api } from "@/api";
import { type SupportImage } from "@/api/images";
import { ImageDraft, useImageDraft, imagesEnabled } from "./ImageDraft";
import { SupportImageView } from "./SupportImages";
import type { TicketAttachment, TicketMessage } from "@/types";

export function Conversation({ messages, resolved, staff = false, disabled = false, requester, ticketId, status, unassigned = false, onSend }: {
  messages: TicketMessage[]; resolved: boolean; staff?: boolean; disabled?: boolean; requester?: string; ticketId?: string; status?: string; unassigned?: boolean;
  onSend: (body: string, wait: boolean, images: SupportImage[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const enabled = imagesEnabled;
  const imageDraft = useImageDraft();
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [imageError, setImageError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (enabled && ticketId) api.getTicketAttachments(ticketId).then(a => { if (active) setAttachments(a); })
      .catch(() => { if (active) setImageError("Images could not be loaded. Refresh to retry."); });
    return () => { active = false; };
  }, [enabled, ticketId, messages]);
  async function send(wait: boolean) {
    if (lock.current || imageDraft.busy || !draft.trim()) return;
    lock.current = true; setBusy(true);
    try { if (await onSend(draft, wait, imageDraft.images)) { setDraft(""); imageDraft.clear(); } }
    catch (e) { setImageError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="Conversation">
    <h2 className="hlabel">Conversation with {staff ? requester ?? "requester" : "IT"}</h2>
    <p className="hint">Messages are shared with the requester and IT. Refresh to check for replies.</p>
    {messages.length ? <ul className="notes conversation-thread">{messages.map((m) => <li key={m.id} className={`message message-${m.senderKind}`}>
      <span className="who">{m.author} · {m.senderKind === "staff" ? "IT" : "Requester"}</span>
      <time className="hint" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString()}</time>
      <p>{m.body}</p>
      <div className="attachment-list">{attachments.filter(a => a.messageId === m.id).map(a => <SupportImageView key={a.id} attachment={a} />)}</div>
    </li>)}</ul> : <p className="hint">No messages yet.</p>}
    {resolved ? <p className="hint">This request is resolved. Start a new request if you need more help.</p> : <>
      <label className="field"><span className="label">Message</span>
        <textarea rows={3} maxLength={4000} value={draft} disabled={disabled || busy} onChange={(e) => setDraft(e.target.value)} />
      </label>
      {imageError ? <p className="banner" role="alert">{imageError}</p> : null}
      <ImageDraft draft={imageDraft} disabled={busy || disabled} />
      {staff ? <p className="hint">{status === "waiting" ? "IT is waiting on the requester. Sending another message keeps this request in Waiting." : `Send keeps the current status. Send & wait moves this request to Waiting${unassigned ? " and assigns it to you" : ""}.`}</p> : null}
      <div className="row">
        <button className="btn btn-primary" disabled={disabled || busy || imageDraft.busy || !draft.trim()} onClick={() => void send(false)}>Send message</button>
        {staff && status !== "waiting" ? <button className="btn" disabled={disabled || busy || imageDraft.busy || !draft.trim()} onClick={() => void send(true)}>Send &amp; wait for reply</button> : null}
      </div>
    </>}
  </section>;
}
