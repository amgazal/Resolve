import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, Profile, SessionState } from "@/types";
import { AUTH_EXPIRED_EVENT } from "@/api/authEvents";
import { confirmLeave } from "@/unsaved";
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

function readActiveSession(): string | null {
  try { return window.localStorage.getItem(ACTIVE_SESSION_KEY); }
  catch { return null; }
}
function storeActiveSession(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ACTIVE_SESSION_KEY, id);
    else window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch { /* Storage may be blocked; the current flow still works in memory. */ }
}

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
  const actionLock = useRef(false);
  const authGeneration = useRef(0);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [restoring, setRestoring] = useState(usingLiveBackend);
  const [restoreError, setRestoreError] = useState(false);
  const [restoreRetry, setRestoreRetry] = useState(0);

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
  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    const expired = () => {
      authGeneration.current++;
      setProfile(null); setCatalog(null); setSession(null); setStage("landing");
      setSurface("support"); setRestoring(false); setRestoreError(false);
      setError("Your session has ended. Sign in again to continue.");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
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
    let cancelled = false;
    setCatalogError(false);
    api.getCatalog()
      .then((c) => {
        if (cancelled) return;
        setCatalog(c);
        if (c.devices[0]) setDevice(c.devices[0]);
        if (c.systems[0]) setOs(c.systems[0]);
      })
      .catch(() => { if (!cancelled) setCatalogError(true); });
    return () => { cancelled = true; };
  }, [profile, catalogRetry]);

  // The live backend can resume an unfinished diagnosis after a refresh.
  // Demo mode intentionally stays ephemeral, so a stale mock id is never restored.
  useEffect(() => {
    if (!profile || !usingLiveBackend) return;
    const id = readActiveSession();
    if (!id) { setRestoring(false); return; }
    setRestoring(true); setRestoreError(false);

    let cancelled = false;
    api.getSession(id)
      .then((restored) => {
        if (cancelled) return;
        if (restored.status === "escalated" || restored.status === "abandoned") {
          storeActiveSession(null);
          return;
        }
        setSession(restored);
        setStage(stageForSession(restored));
      })
      .catch(() => { if (!cancelled) setRestoreError(true); })
      .finally(() => { if (!cancelled) setRestoring(false); });

    return () => { cancelled = true; };
  }, [profile, restoreRetry]);

  useEffect(() => {
    if (!usingLiveBackend) return;
    if (session?.status === "in_progress") {
      storeActiveSession(session.id);
    } else if (session) {
      storeActiveSession(null);
    }
  }, [session]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, allowSignOut = false): Promise<T | undefined> => {
    if (actionLock.current) return undefined;
    actionLock.current = true;
    const generation = authGeneration.current;
    setBusy(true);
    setError(null);
    try { const value = await fn(); return allowSignOut || generation === authGeneration.current ? value : undefined; }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { actionLock.current = false; setBusy(false); }
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
    if (s) { setSession(s); setStage(stageForSession(s)); }
  }

  async function choose(optionId: string) {
    if (!session) return;
    const s = await run(() => api.answer(session.id, optionId));
    if (!s) return;
    setSession(s);
    if (s.diagnosis) {
      setStepPhase("idle");
      setStage("fix");
    }
  }

  async function undo() {
    if (!session) return;
    const s = await run(() => api.undoLastAnswer(session.id));
    if (s) { setSession(s); setStage(stageForSession(s)); }
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
      storeActiveSession(null);
      setSession((current) => current ? { ...current, status: "escalated" } : current);
      setReference(t.reference);
      setStage("sent");
    }
  }

  function clearFlow() {
    storeActiveSession(null);
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
    if (p) { setProfile(p); setSurface(!usingLiveBackend && p.role === "admin" ? "editor" : !usingLiveBackend && p.role === "technician" ? "desk" : "support"); flash(`Signed in as ${p.fullName}`); }
  }

  async function signOut() {
    if (!confirmLeave()) return;
    const signedOut = await run(async () => { await api.signOut(); return true; }, true);
    if (signedOut) { setError(null); setRestoreError(false); setProfile(null); clearFlow(); setSurface("support"); }
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
                  onClick={() => { if (surface !== "support" && confirmLeave()) setSurface("support"); }}
                >
                  Get help
                </button>
                <button
                  aria-pressed={surface === "desk"}
                  className={surface === "desk" ? "on" : ""}
                  onClick={() => { if (surface !== "desk" && confirmLeave()) setSurface("desk"); }}
                >
                  IT desk
                </button>
                {isAdmin ? (
                  <button
                    aria-pressed={surface === "editor"}
                    className={surface === "editor" ? "on" : ""}
                    onClick={() => { if (surface !== "editor" && confirmLeave()) setSurface("editor"); }}
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
              {usingLiveBackend ? profile.fullName.split(" ")[0] : "Switch role"}
              <span className="role-chip">{profile.role.replace("_", " ")}</span>
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="banner" role="alert">
          <span>{error}</span>
          {usingLiveBackend && session ? <button className="btn btn-plain btn-sm" disabled={busy} onClick={async () => {
            const restored = await run(() => api.getSession(session.id));
            if (restored) { setSession(restored); setStage(stageForSession(restored)); setStepPhase("idle"); }
          }}>Reload saved progress</button> : null}
          <button className="btn btn-plain btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      ) : null}

      <main className="page">
        {!profile ? (
          <SignIn onSubmit={signIn} busy={busy} />
        ) : restoreError ? (
          <div className="empty" role="alert"><p>We couldn't restore your support session. Retry, sign in again, or start a new request.</p>
            <button className="btn" onClick={() => setRestoreRetry((n) => n + 1)}>Retry</button>
            <button className="btn" onClick={() => { clearFlow(); setRestoreError(false); }}>Start a new request</button>
          </div>
        ) : restoring ? <div className="loading" role="status">Restoring your support session…</div>
        : catalogError ? <div className="empty" role="alert"><p>We couldn't load the categories.</p><button className="btn" onClick={() => setCatalogRetry((n) => n + 1)}>Retry</button></div>
        : surface === "desk" && isStaff ? (
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
          Demo mode · Example data resets on reload.
        </p>
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
