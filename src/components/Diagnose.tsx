import type { SessionState } from "@/types";
import { Icon } from "./Icon";

export function Diagnose({
  session, onChoose, onUndo, busy,
}: {
  session: SessionState;
  onChoose: (optionId: string) => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const answered = session.path.filter((n) => n.answer);

  return (
    <>
      <header className="col-head">
        <p className="label">Step 1 of 3 · Narrowing it down</p>
        <h2 className="col-title">Let's work out what's actually happening.</h2>
        <p className="hint">One question at a time. "Not sure" is a real answer — it tells us something too.</p>
      </header>

      {answered.length > 0 && (
        <ol className="transcript">
          {answered.map((a, i) => (
            <li key={i}>
              <span className="t-num">{String(i + 1).padStart(2, "0")}</span>
              <span className="t-q">{a.label}</span>
              <span className="t-a">{a.answer}</span>
            </li>
          ))}
        </ol>
      )}

      {session.node ? (
        <div className="ask rise" key={session.node.id}>
          <p className="ask-q">{session.node.question}</p>
          <div className="choices">
            {session.node.options.map((o) => (
              <button key={o.id} className="choice" disabled={busy} onClick={() => onChoose(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ask rise">
          <p className="ask-q settling">Working out what this points to…</p>
        </div>
      )}

      {answered.length > 0 && (
        <button className="btn btn-plain btn-under" onClick={onUndo} disabled={busy}>
          <Icon name="back" size={16} />Change my last answer
        </button>
      )}
    </>
  );
}
