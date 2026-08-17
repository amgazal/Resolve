import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, Profile, SessionState } from "@/types";
import { api, usingLiveBackend } from "@/api";

import { Trail } from "@/components/Trail";
import { SignIn } from "@/components/SignIn";
import { Landing } from "@/components/Landing";
import { Diagnose } from "@/components/Diagnose";
import { Fix } from "@/components/Fix";
import { Escalate } from "@/components/Escalate";
import { Resolved, Sent } from "@/components/Closing";
import { ITDesk } from "@/technician/ITDesk";
import { TreeEditor } from "@/admin/TreeEditor";

import "@/styles/resolve.css";

type Surface = "support" | "desk" | "editor";
type Stage = "landing" | "diagnose" | "fix" | "escalate" | "resolved" | "sent";

const ACTIVE_SESSION_KEY = "resolve.activeSessionId";

function stageForSession(session: SessionState): Stage {
  if (session.status === "resolved") return "resolved";
  if (session.status === "escalated" || session.status === "abandoned") return "landing";
  if (session.node) return "diagnose";
  if (session.diagnosis) {
    const failed = session.attempts.filter((a) => a.outcome === "failed").length;
    return failed >= session.diagnosis.steps.length ? "escalate" : "fix";
  }
  return "landing";
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);
  const [surface, setSurface] = useState<Surface>("support");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [stage, setStage] = useState<Stage>("landing");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [device, setDevice] = useState("Laptop");
  const [os, setOs] = useState("macOS");
  const [session, setSession] = useState<SessionState | null>(null);
  const [stepPhase, setStepPhase] = useState<"idle" | "trying">("idle");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const diagnosisTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(diagnosisTimer.current);
  }, []);

  /* ------------------------------- session ------------------------------ */

  useEffect(() => {
    api.getProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!profile) { setCatalog(null); return; }
    api.getCatalog()
      .then((c) => {
        setCatalog(c);
        if (c.devices[0]) setDevice(c.devices[0]);
        if (c.systems[0]) setOs(c.systems[0]);
      })
      .catch((e: Error) => setError(e.message));
  }, [profile]);

  // The live backend can resume an unfinished diagnosis after a refresh.
  // Demo mode intentionally stays ephemeral, so a stale mock id is never restored.
  useEffect(() => {
    if (!profile || !usingLiveBackend) return;
    const id = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    if (!id) return;

    let cancelled = false;
    api.getSession(id)
      .then((restored) => {
        if (cancelled) return;
        if (restored.status === "escalated" || restored.status === "abandoned") {
          window.localStorage.removeItem(ACTIVE_SESSION_KEY);
          return;
        }
        setSession(restored);
        setStage(stageForSession(restored));
      })
      .catch(() => {
        window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      });

    return () => { cancelled = true; };
  }, [profile]);

  useEffect(() => {
    if (!usingLiveBackend) return;
    if (session?.status === "in_progress") {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    } else if (session) {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }, [session]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { return await fn(); }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }, []);

  const isStaff = profile?.role === "technician" || profile?.role === "admin";
  const isAdmin = profile?.role === "admin";

  /* -------------------------------- flow -------------------------------- */

  const failedSoFar = session?.attempts.filter((a) => a.outcome === "failed").length ?? 0;

  async function start() {
    if (!categoryId) return;
    const s = await run(() => api.startSession({
      categoryId, description, device, operatingSystem: os,
    }));
    if (s) { setSession(s); setStage("diagnose"); }
  }

  async function choose(optionId: string) {
    if (!session) return;
    const s = await run(() => api.answer(session.id, optionId));
    if (!s) return;
    setSession(s);
    if (s.diagnosis) {
      setStepPhase("idle");
      window.clearTimeout(diagnosisTimer.current);
      diagnosisTimer.current = window.setTimeout(() => setStage("fix"), 420);
    }
  }

  async function undo() {
    if (!session) return;
    const s = await run(() => api.undoLastAnswer(session.id));
    if (s) { setSession(s); setStage("diagnose"); }
  }

  async function mark(outcome: "fixed" | "failed") {
    if (!session?.diagnosis) return;
    const step = session.diagnosis.steps[failedSoFar];
    if (!step) return;
    const s = await run(() => api.recordAttempt(session.id, step.id, outcome));
    if (!s) return;
    setSession(s);
    setStepPhase("idle");
    if (outcome === "fixed") setStage("resolved");
    else if (failedSoFar + 1 >= (s.diagnosis?.steps.length ?? 0)) setStage("escalate");
  }

  async function send() {
    if (!session) return;
    const t = await run(() => api.escalate(session.id, note));
    if (t) {
      window.localStorage.removeItem(ACTIVE_SESSION_KEY);
      setSession((current) => current ? { ...current, status: "escalated" } : current);
      setReference(t.reference);
      setStage("sent");
    }
  }

  function clearFlow() {
    window.clearTimeout(diagnosisTimer.current);
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    setStage("landing"); setDescription(""); setCategoryId(null); setSession(null);
    setNote(""); setReference(null); setStepPhase("idle");
  }

  async function restart() {
    if (session?.status === "in_progress") {
      const abandoned = await run(async () => {
        await api.abandonSession(session.id);
        return true;
      });
      if (!abandoned) return;
    }
    clearFlow();
  }

  async function signIn(email: string, password: string) {
    const p = await run(() => api.signIn(email, password));
    if (p) { setProfile(p); setSurface("support"); flash(`Signed in as ${p.fullName}`); }
  }

  async function signOut() {
    if (session?.status === "in_progress") {
      await run(() => api.abandonSession(session.id));
    }
    await run(() => api.signOut());
    setProfile(null); clearFlow(); setSurface("support");
  }

  /* ------------------------------- render ------------------------------- */

  if (checking) return <div className="rsv"><div className="loading">One moment…</div></div>;

  return (
    <div className="rsv">
      <header className="masthead">
        <div className="wordmark">
          <span className="wordmark-dot" aria-hidden="true" />
          <span className="wordmark-name">Resolve</span>
          <span className="wordmark-org">Northgate IT</span>
        </div>

        {profile ? (
          <div className="masthead-right">
            {surface === "support" && stage !== "landing" ? (
              <button className="btn btn-plain" onClick={() => void restart()} disabled={busy}>Start over</button>
            ) : null}

            {isStaff ? (
              <div className="switch" role="group" aria-label="Choose a view">
                <button
                  aria-pressed={surface === "support"}
                  className={surface === "support" ? "on" : ""}
                  onClick={() => setSurface("support")}
                >
                  Get help
                </button>
                <button
                  aria-pressed={surface === "desk"}
                  className={surface === "desk" ? "on" : ""}
                  onClick={() => setSurface("desk")}
                >
                  IT desk
                </button>
                {isAdmin ? (
                  <button
                    aria-pressed={surface === "editor"}
                    className={surface === "editor" ? "on" : ""}
                    onClick={() => setSurface("editor")}
                  >
                    Questions
                  </button>
                ) : null}
              </div>
            ) : null}

            <button
              className="btn btn-plain who-btn"
              onClick={() => void signOut()}
              title="Sign out"
              aria-label={`Sign out ${profile.fullName}`}
              disabled={busy}
            >
              {profile.fullName.split(" ")[0]}
              <span className="role-chip">{profile.role.replace("_", " ")}</span>
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      ) : null}

      <main className="page">
        {!profile ? (
          <SignIn onSubmit={signIn} busy={busy} />
        ) : surface === "desk" && isStaff ? (
          <ITDesk flash={flash} onError={setError} />
        ) : surface === "editor" && isAdmin ? (
          catalog
            ? <TreeEditor categories={catalog.categories} flash={flash} onError={setError} />
            : <div className="loading">Loading categories…</div>
        ) : !catalog ? (
          <div className="loading">Getting things ready…</div>
        ) : stage === "landing" ? (
          <Landing
            catalog={catalog}
            firstName={profile.fullName.split(" ")[0] ?? ""}
            description={description} setDescription={setDescription}
            categoryId={categoryId} setCategoryId={setCategoryId}
            device={device} setDevice={setDevice}
            os={os} setOs={setOs}
            onStart={start} busy={busy}
          />
        ) : stage === "resolved" && session ? (
          <Resolved session={session} onDone={restart} />
        ) : stage === "sent" && reference ? (
          <Sent
            reference={reference}
            canSeeQueue={isStaff}
            onView={() => setSurface("desk")}
            onDone={restart}
          />
        ) : session ? (
          <div className="workspace">
            <section className="column">
              {stage === "diagnose" ? (
                <Diagnose session={session} onChoose={choose} onUndo={undo} busy={busy} />
              ) : stage === "fix" ? (
                <Fix
                  session={session} activeIndex={failedSoFar} phase={stepPhase}
                  setPhase={setStepPhase} onMark={mark}
                  onSkip={() => setStage("escalate")} busy={busy}
                />
              ) : (
                <Escalate
                  session={session} note={note} setNote={setNote}
                  onSend={send} onBack={() => setStage("fix")} busy={busy} flash={flash}
                />
              )}
            </section>

            <aside className="sidebar">
              <div className="cardlet">
                <p className="label">Your report</p>
                <p className="said">{session.description || "No description given"}</p>
                <p className="meta">
                  {[session.device, session.operatingSystem, session.categoryLabel]
                    .filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="cardlet">
                <p className="label">What we know</p>
                {session.facts.length ? (
                  <dl className="facts">
                    {session.facts.map((f, i) => (
                      <div className="fact" key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>
                    ))}
                  </dl>
                ) : (
                  <p className="hint">
                    This fills in as you answer. It's exactly what your IT team will see.
                  </p>
                )}
              </div>

              <div className="cardlet">
                <p className="label">Where we are</p>
                <Trail nodes={session.path} />
              </div>
            </aside>
          </div>
        ) : null}
      </main>

      {!usingLiveBackend && profile ? (
        <p className="demo-flag">
          Demo data — connect Supabase in <code>.env</code> to run against the real database.
        </p>
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
