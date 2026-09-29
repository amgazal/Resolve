import { useUnsavedChanges } from '@/unsaved';
import { useState } from 'react';
import type { Catalog, SessionState } from '@/types';
import { type ImageDraftState } from './ImageDraft';
export function IssueDetailsEditor({ session, catalog, images, busy, onSave, onCancel }: {
  session: SessionState; catalog: Catalog; images: ImageDraftState; busy: boolean;
  onSave: (details: { description: string; device: string; operatingSystem: string }) => Promise<void>; onCancel: () => void;
}) {
  const [description, setDescription] = useState(session.description);
  const [device, setDevice] = useState(session.device ?? '');
  const [operatingSystem, setSystem] = useState(session.operatingSystem ?? '');
  useUnsavedChanges(description !== session.description || device !== session.device || operatingSystem !== session.operatingSystem);
  return <section className="issue-editor" aria-label="Edit issue details">
    <h3 className="col-title">Correct your issue details</h3>
    <p className="hint">Your answers stay the same. Changes are saved only when you choose Save details.</p>
    <label className="field"><span className="label">Problem description</span><textarea autoFocus rows={4} maxLength={4000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} /></label>
    <div className="context">
      <label className="picker"><span>Device</span><select value={device} disabled={busy} onChange={e => setDevice(e.target.value)}><option value="">Choose device</option>{catalog.devices.map(d => <option key={d}>{d}</option>)}</select></label>
      <label className="picker"><span>System</span><select value={operatingSystem} disabled={busy} onChange={e => setSystem(e.target.value)}><option value="">Choose system</option>{catalog.systems.map(d => <option key={d}>{d}</option>)}</select></label>
    </div>
    <div className="row"><button className="btn btn-primary" disabled={busy || images.busy} onClick={() => void onSave({ description, device, operatingSystem })}>{busy ? 'Saving…' : 'Save details'}</button><button className="btn" disabled={busy} onClick={onCancel}>Cancel details edit</button></div>
  </section>;
}
