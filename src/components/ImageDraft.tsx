import { useEffect, useRef, useState } from 'react';
import { normalizeImage, type SupportImage } from '@/api/images';
import { usingLiveBackend } from '@/api';
export const imagesEnabled = !usingLiveBackend || import.meta.env.VITE_TICKET_IMAGES_ENABLED === 'true';
export type DraftImage = SupportImage & { preview: string };
export function useImageDraft() {
  const [images, setImages] = useState<DraftImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = useRef(images); current.current = images;
  const generation = useRef(0), lock = useRef(false);
  function clear() { generation.current++; current.current.forEach(i => URL.revokeObjectURL(i.preview)); current.current = []; setImages([]); setError(undefined); }
  useEffect(() => () => { generation.current++; current.current.forEach(i => URL.revokeObjectURL(i.preview)); }, []);
  async function select(files: File[]) {
    if (lock.current || !files.length) return;
    if (files.length + current.current.length > 3) { setError('Attach at most three images per message.'); return; }
    const version = generation.current;
    lock.current = true; setBusy(true); setError(undefined);
    const added: DraftImage[] = [];
    try {
      for (const file of files) {
        const image = await normalizeImage(file);
        if (version !== generation.current) { added.forEach(i => URL.revokeObjectURL(i.preview)); return; }
        added.push({ ...image, preview: URL.createObjectURL(image.file) });
      }
      current.current = [...current.current, ...added]; setImages(current.current);
    } catch (e) { added.forEach(i => URL.revokeObjectURL(i.preview)); if (version === generation.current) setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  }
  function remove(index: number) {
    const image = current.current[index]; if (image) URL.revokeObjectURL(image.preview);
    current.current = current.current.filter((_, i) => i !== index); setImages(current.current);
  }
  return { images, busy, error, select, remove, clear };
}
export type ImageDraftState = ReturnType<typeof useImageDraft>;
export function ImageDraft({ draft, disabled = false, initial = false, previewsOnly = false, pickerOnly = false, inputLabel }: { draft: ImageDraftState; disabled?: boolean; initial?: boolean; previewsOnly?: boolean; pickerOnly?: boolean; inputLabel?: string }) {
  if (!imagesEnabled || initial) return null;
  const pickerLabel = inputLabel ?? 'Attach image';
  return <div className="image-draft">
    {!previewsOnly ? <>
      <label className="attachment-picker"><span className="image-add-button">+ {pickerLabel}</span>
        <input className="image-file-input" aria-label={pickerLabel} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || draft.busy || draft.images.length >= 3}
          onChange={e => { const files = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void draft.select(files); }} />
      </label>
      <p className="hint">{pickerOnly ? 'Up to 3 images. Don’t include passwords or verification codes.' : 'Up to 3 JPG, PNG or WebP images. Don’t include passwords or verification codes.'}</p>
    </> : null}
    {draft.busy ? <p role="status" className="hint">Preparing image…</p> : null}
    {draft.error ? <p role="alert" className="banner">{draft.error}</p> : null}
    <div className="attachment-list">{(pickerOnly ? [] : draft.images).map((image, i) => <div className="support-image" key={image.preview}>
      <img className="queued-image" src={image.preview} alt={`Preview: ${image.file.name}`} />
      <span className="hint image-name">{image.file.name} · {Math.ceil(image.file.size / 1024)} KB</span>
      <button className="btn btn-sm" disabled={disabled || draft.busy} onClick={() => draft.remove(i)}>Remove {image.file.name}</button>
    </div>)}</div>
  </div>;
}
