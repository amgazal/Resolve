import { useEffect, useRef, useState } from "react";
import { ImageDraft, type ImageDraftState } from "./ImageDraft";
import { IssueDetailsEditor } from "./IssueDetailsEditor";
import type { Catalog, SessionState } from "@/types";
import { Icon } from "./Icon";

/**
 * The handoff is shown as a document rather than a terminal dump. The
 * person sending it is not a developer, and what they are doing here is
 * signing off on a summary about them — it should look like one.
 */
export function Escalate({
  session, note, setNote, onSend, onBack, busy, flash, catalog, images, onSaveDetails, onUndo, onRestart,
}: {
  session: SessionState;
  catalog: Catalog; images: ImageDraftState;
  onSaveDetails: (details: { description: string; device: string; operatingSystem: string }) => Promise<boolean>;
  onUndo: () => void; onRestart: () => void;
  note: string;
  setNote: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  busy: boolean;
  flash: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const authIssue = ["mfa","locked","stale","reset"].includes(session.diagnosis?.key ?? "");
  const problem = session.diagnosis
    ? session.diagnosis.title.replace("The printer isn't mapped to this device.", "The printer is not configured on this device.").replace(/\.$/, "")
    : "Not yet determined";

  const asText = [
    `Reported: ${session.description || "No additional description provided."}`,
    `Device: ${[session.device, session.operatingSystem].filter(Boolean).join(" · ")}`,
    `Category: ${session.categoryLabel}`,
    `Assessment: ${problem}`,
    "",
    "What we learned",
    ...session.facts.map((f) => `  ${f.label}: ${f.value}`),
    "",
    "Troubleshooting attempted",
    ...(session.attempts.length
      ? session.attempts.map((a) => `  ${a.title}`)
      : ["  (nothing yet)"]),
    "",
    "Outcome: Issue still not resolved",
    `Additional note: ${note.trim() || "None"}`,
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText);
      flash("Summary copied");
    } catch {
      flash("Couldn't copy — select the text and copy it manually");
    }
  }

  return (
    <>
      <header className="col-head">
        <p className="label">Step 3 of 3 · Review</p>
        <h2 className="col-title">Review your request</h2>
        <p className="hint">Check the details, then send it to IT.</p>
      </header>

      {editing ? <IssueDetailsEditor session={session} catalog={catalog} images={images} busy={busy}
        onCancel={() => { setEditing(false); }}
        onSave={async details => { if (await onSaveDetails(details)) { setEditing(false); } }} /> : null}

      <article className="handoff">
        <div className="handoff-head">
          <div>
            <p className="label">Request summary</p>
            <p className="said">Review your request</p>
          </div>
          <div className="summary-actions">
            <button ref={editButton} className="btn btn-plain btn-sm" disabled={busy || editing} onClick={() => setEditing(true)}>Edit</button>
            {session.facts.length ? <button className="btn btn-plain btn-sm" disabled={busy || editing} onClick={onUndo}>Review answers</button> : null}
            <button className="btn btn-plain btn-sm" disabled={busy || editing} onClick={onRestart}>Start over</button>
            <button className="btn btn-plain btn-sm" onClick={copy}><Icon name="copy" size={15} />Copy as text</button>
          </div>
        </div>

        <div className="handoff-body">
          <section>
            <div className="summary-row">
              <p className="hlabel">Issue</p>
              <button className="btn btn-plain btn-sm" disabled={busy || editing} onClick={() => setEditing(true)}>Edit</button>
            </div>
            <p className="said">{session.description || "No additional description provided."}</p>
          </section>

          <dl className="facts fact-grid">
            <div className="fact"><dt>Device</dt><dd>{[session.device, session.operatingSystem].filter(Boolean).join(" · ")}</dd></div>
            <div className="fact"><dt>Category</dt><dd>{session.categoryLabel}</dd></div>
          </dl>

          <section className="handoff-assessment">
            <div className="summary-row"><p className="hlabel">Assessment</p></div>
            <p className="said"><strong>{problem}</strong></p>
          </section>

          <section>
            <div className="summary-row"><p className="hlabel">What we learned</p></div>
            {!session.facts.length ? <p className="hint">No diagnostic facts recorded.</p> : null}
            <dl className="facts">
              {session.facts.map((f, i) => (
                <div className="fact" key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
              ))}
            </dl>
          </section>

          <section>
            <div className="summary-row"><p className="hlabel">What you tried</p></div>
            {session.attempts.length
              ? <ul className="checks">{session.attempts.map((a, i) => <li key={i}>{a.title}</li>)}</ul>
              : <p className="hint">No troubleshooting attempted. IT can help from here.</p>}
          </section>

          <section>
            <div className="summary-row"><p className="hlabel">Supporting image</p><button className="btn btn-plain btn-sm" disabled={busy || editing} onClick={() => { /* no-op for layout */ }}>Add</button></div>
            <ImageDraft draft={images} disabled={busy} pickerOnly />
            {images.images.length ? <div className="image-collection"><ImageDraft draft={images} disabled={busy} previewsOnly /></div> : null}
          </section>

          <section>
            <div className="summary-row"><p className="hlabel">Additional note</p><button className="btn btn-plain btn-sm" disabled={busy || editing} onClick={() => {}}>Edit</button></div>
            <p className="said">{note.trim() || "No note added."}</p>
          </section>
        </div>
      </article>

      <div className="notefield">
        <label className="label" htmlFor="note">Additional note for IT (optional)</label>
        <textarea
          id="note" rows={3} value={note} maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
          aria-describedby="note-help"
          placeholder="Error message, when it started, or anything else IT should know."
        />
        <p id="note-help" className="hint">{authIssue ? "Don’t include passwords or verification codes." : "Keep it brief. Include what changed and any exact error text."}</p>
      </div>

      <div className="review-footer">
        <p className="hint subtle">Nothing is sent until you send it.</p>
      </div>

      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={onSend} disabled={busy || images.busy || editing}>
          {busy ? "Sending…" : "Send to IT"}
        </button>
        <button className="btn btn-plain" onClick={onBack} disabled={busy || editing}>Review troubleshooting steps</button>
      </div>
    </>
  );
}
