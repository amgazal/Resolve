import type { SessionState } from "@/types";
import { stepGuidance, stepTitle, authenticationDiagnoses } from "@/data/guidance";
import { Icon } from "./Icon";

export function Fix({
  session, activeIndex, phase, setPhase, onMark, onSkip, busy,
}: {
  session: SessionState;
  activeIndex: number;
  phase: "idle" | "trying";
  setPhase: (p: "idle" | "trying") => void;
  onMark: (outcome: "fixed" | "failed") => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const dx = session.diagnosis;
  if (!dx) return null;

  return (
    <>
      <header className="col-head">
        <p className="label">Step 2 of 3 · Likely fix</p>
        <h2 className="col-title">{dx.title}</h2>
        <p className="hint">
          A few things to try, most likely first. Do one, tell us what happened,
          and we'll take it from there.
        </p>
      </header>

      {authenticationDiagnoses.has(dx.key) ? <p className="security-hint">Never paste passwords, verification codes, or recovery codes into Resolve notes or messages.</p> : null}
      <ol className="steps">
        {dx.steps.map((s, i) => {
          const stateName = i < activeIndex ? "done" : i === activeIndex ? "now" : "later";
          return (
            <li className={`step is-${stateName}`} key={s.id}>
              <span className="step-num">
                {stateName === "done" ? <Icon name="check" size={14} /> : i + 1}
              </span>
              <div className="step-body">
                <p className="step-title">{stepTitle(dx.key, s)}</p>
                {stateName === "now" ? (
                  <>
                    <p className="label active-step-label">Current step{session.operatingSystem && session.operatingSystem !== "Not sure" ? ` · ${session.operatingSystem}` : ""}</p>
                    <p className="step-detail">{stepGuidance(dx.key, s, session.operatingSystem)}</p>
                    {phase === "idle" ? (
                      <button className="btn btn-primary" onClick={() => setPhase("trying")}>
                        Try this
                      </button>
                    ) : (
                      <div className="rise">
                        <p className="step-ask">How did that go?</p>
                        <div className="choices">
                          <button className="choice choice-good" disabled={busy} onClick={() => onMark("fixed")}>
                            That fixed it
                          </button>
                          <button className="choice" disabled={busy} onClick={() => onMark("failed")}>
                            Still not working
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : stateName === "done" ? (
                  <p className="step-detail muted">Tried — didn't fix the issue.</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <button className="btn btn-plain btn-under" onClick={onSkip} disabled={busy}>
        Skip ahead and send this to IT
      </button>
    </>
  );
}
