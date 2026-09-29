import { useEffect, useRef, useState } from "react";
import { api, usingLiveBackend } from "@/api";
import { normalizeImage, type SupportImage } from "@/api/images";
import { SupportImageView } from "./SupportImages";
import type { TicketAttachment, TicketMessage } from "@/types";

export function Conversation({ messages, resolved, staff = false, disabled = false, requester, ticketId, status, unassigned = false, onSend }: {
  messages: TicketMessage[]; resolved: boolean; staff?: boolean; disabled?: boolean; requester?: string; ticketId?: string; status?: string; unassigned?: boolean;
  onSend: (body: string, wait: boolean, images: SupportImage[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const enabled = !usingLiveBackend || import.meta.env.VITE_TICKET_IMAGES_ENABLED === "true";
  const [images, setImages] = useState<(SupportImage & { preview: string })[]>([]);
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [imageError, setImageError] = useState<string>();
  const mounted = useRef(true);
  const previews = useRef(images); previews.current = images;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; previews.current.forEach(i => URL.revokeObjectURL(i.preview)); }; }, []);
  useEffect(() => {
    let active = true;
    if (enabled && ticketId) api.getTicketAttachments(ticketId).then(a => { if (active) setAttachments(a); })
      .catch(() => { if (active) setImageError("Images could not be loaded. Refresh to retry."); });
    return () => { active = false; };
  }, [enabled, ticketId, messages]);
  async function selectImages(files: File[]) {
    if (lock.current) return;
    if (files.length + images.length > 3) { setImageError("Attach at most three images per message."); return; }
    lock.current = true; setBusy(true); setImageError(undefined);
    const added: (SupportImage & { preview: string })[] = [];
    try {
      for (const file of files) { const image = await normalizeImage(file); if (!mounted.current) { added.forEach(i => URL.revokeObjectURL(i.preview)); return; } added.push({ ...image, preview: URL.createObjectURL(image.file) }); }
      setImages(current => [...current, ...added]);
    } catch (e) { added.forEach(i => URL.revokeObjectURL(i.preview)); setImageError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }

  async function send(wait: boolean) {
    if (lock.current || !draft.trim()) return;
    lock.current = true; setBusy(true);
    try { if (await onSend(draft, wait, images)) { setDraft(""); images.forEach(i => URL.revokeObjectURL(i.preview)); setImages([]); } }
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
      {enabled ? <>
        <label className="field attachment-picker"><span className="label">Attach image</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy || disabled || images.length >= 3}
            onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ""; void selectImages(files); }} />
        </label>
        <p className="hint">Up to 3 JPEG, PNG, or WebP images · 5 MB each. Add a message for context. Location metadata is removed.{!usingLiveBackend ? " Demo images reset on reload." : ""}</p>
        <div className="attachment-list">{images.map((image, i) => <div className="support-image" key={image.preview}>
          <img className="queued-image" src={image.preview} alt={`Preview: ${image.file.name}`} />
          <span className="hint image-name">{image.file.name} · {Math.ceil(image.file.size / 1024)} KB</span>
          <button className="btn btn-sm" disabled={busy || disabled} onClick={() => { URL.revokeObjectURL(image.preview); setImages(current => current.filter((_, n) => n !== i)); }}>Remove {image.file.name}</button>
        </div>)}</div>
      </> : null}
      {staff ? <p className="hint">{status === "waiting" ? "IT is waiting on the requester. Sending another message keeps this request in Waiting." : `Send keeps the current status. Send & wait moves this request to Waiting${unassigned ? " and assigns it to you" : ""}.`}</p> : null}
      <div className="row">
        <button className="btn btn-primary" disabled={disabled || busy || !draft.trim()} onClick={() => void send(false)}>Send message</button>
        {staff && status !== "waiting" ? <button className="btn" disabled={disabled || busy || !draft.trim()} onClick={() => void send(true)}>Send &amp; wait for reply</button> : null}
      </div>
    </>}
  </section>;
}
