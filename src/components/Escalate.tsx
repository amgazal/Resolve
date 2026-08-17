import type { SessionState } from "@/types";
import { Icon } from "./Icon";

/**
 * The handoff is shown as a document rather than a terminal dump. The
 * person sending it is not a developer, and what they are doing here is
 * signing off on a summary about them — it should look like one.
 */
export function Escalate({
  session, note, setNote, onSend, onBack, busy, flash,
}: {
  session: SessionState;
  note: string;
  setNote: (v: string) => void;
  onSend: () => void;
  onBack: () => void;
  busy: boolean;
  flash: (msg: string) => void;
}) {
  const problem = session.diagnosis
    ? session.diagnosis.title.replace(/\.$/, "")
    : "Not yet determined";

  const asText = [
    `Reported: ${session.description || "(no description given)"}`,
    `Device: ${[session.device, session.operatingSystem].filter(Boolean).join(" · ")}`,
    `Category: ${session.categoryLabel}`,
    `Assessment: ${problem}`,
    "",
    "Confirmed",
    ...session.facts.map((f) => `  ${f.label}: ${f.value}`),
    "",
    "Already tried",
    ...(session.attempts.length
      ? session.attempts.map((a) => `  ${a.title}`)
      : ["  (nothing yet)"]),
    "",
    "Result: Issue persists",
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
        <p className="label">Step 3 of 3 · Handing over</p>
        <h2 className="col-title">You've done the useful troubleshooting. Let's pass this on.</h2>
        <p className="hint">This is exactly what your IT team receives. Nothing is sent until you send it.</p>
      </header>

      <article className="handoff">
        <div className="handoff-head">
          <p className="label">Summary for the IT team</p>
          <button className="btn btn-plain btn-sm" onClick={copy}>
            <Icon name="copy" size={15} />Copy as text
          </button>
        </div>

        <div className="handoff-body">
          <section>
            <p className="hlabel">In their words</p>
            <p className="said">{session.description || "No description given"}</p>
          </section>

          <dl className="facts">
            <div className="fact">
              <dt>Device</dt>
              <dd>{[session.device, session.operatingSystem].filter(Boolean).join(" · ")}</dd>
            </div>
            <div className="fact"><dt>Category</dt><dd>{session.categoryLabel}</dd></div>
            <div className="fact"><dt>Assessment</dt><dd className="strong">{problem}</dd></div>
          </dl>

          <section>
            <p className="hlabel">Confirmed</p>
            <dl className="facts">
              {session.facts.map((f, i) => (
                <div className="fact" key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
              ))}
            </dl>
          </section>

          <section>
            <p className="hlabel">Already tried</p>
            <ul className="checks">
              {session.attempts.length
                ? session.attempts.map((a, i) => <li key={i}>{a.title}</li>)
                : <li className="muted">Nothing yet</li>}
            </ul>
          </section>

          <p className="result">Result — Issue persists</p>
        </div>
      </article>

      <div className="notefield">
        <label className="label" htmlFor="note">Anything else worth knowing?</label>
        <textarea
          id="note" rows={3} value={note} maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional. When it started, where you were, anything that seemed related."
        />
      </div>

      <div className="row">
        <button className="btn btn-primary btn-lg" onClick={onSend} disabled={busy}>
          {busy ? "Sending…" : "Send to IT"}
        </button>
        <button className="btn btn-plain" onClick={onBack} disabled={busy}>Back to the steps</button>
      </div>
    </>
  );
}
