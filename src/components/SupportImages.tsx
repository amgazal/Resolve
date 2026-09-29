import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { TicketAttachment } from '@/types';

export function SupportImageView({ attachment }: { attachment: TicketAttachment }) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true; let objectUrl: string | undefined;
    api.getAttachmentImage(attachment).then(blob => {
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment, visible]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  function close() { dialog.current?.close(); setOpen(false); button.current?.focus(); }
  return <div ref={root} className="support-image">
    <button ref={button} className="image-thumbnail" onFocus={() => setVisible(true)} onClick={() => { setVisible(true); setOpen(true); }} aria-label={`View ${attachment.filename}`}>
      {url ? <img src={url} alt={attachment.filename} width={attachment.width} height={attachment.height} loading="lazy" />
        : <span className="image-placeholder">{error ? 'Image unavailable. Refresh to retry.' : 'Load image'}</span>}
    </button>
    <span className="hint image-name">{attachment.filename}</span>
    {open ? <dialog ref={dialog} className="image-dialog" aria-label={attachment.filename}
      onCancel={e => { e.preventDefault(); close(); }} onClose={() => { setOpen(false); button.current?.focus(); }}
      onKeyDown={e => e.stopPropagation()}>
      <button className="btn" autoFocus onClick={close}>Close image</button>
      {url ? <img src={url} alt={attachment.filename} /> : <p role="status">{error ? "Image unavailable. Refresh to retry." : "Loading image…"}</p>}
      <p className="hint">{attachment.filename}</p>
    </dialog> : null}
  </div>;
}
