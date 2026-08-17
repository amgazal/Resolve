import { useState } from "react";
import { usingLiveBackend } from "@/api";

/**
 * Sign-in exists because the role is a database fact now. Which account
 * you use decides what you can see, and no amount of clicking around the
 * interface changes that.
 */
export function SignIn({
  onSubmit, busy,
}: {
  onSubmit: (email: string, password: string) => void;
  busy: boolean;
}) {
  const [email, setEmail] = useState(usingLiveBackend ? "" : "maya@northgate.test");
  const [password, setPassword] = useState("");

  return (
    <div className="landing">
      <div className="landing-col signin">
        <p className="greeting rise">Welcome back.</p>
        <h1 className="display rise" style={{ animationDelay: "60ms" }}>
          Sign in to get help.
        </h1>
        <p className="lede rise" style={{ animationDelay: "100ms" }}>
          Your account decides what you see. Most people land straight in support;
          the IT desk and the question editor open only for the team that runs them.
        </p>

        <form
          className="signin-form rise"
          style={{ animationDelay: "150ms" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && email.trim() && (!usingLiveBackend || password)) {
              onSubmit(email.trim(), password);
            }
          }}
        >
          <label className="field">
            <span className="label">Work email</span>
            <input
              type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@northgate.test"
            />
          </label>

          {usingLiveBackend ? (
            <label className="field">
              <span className="label">Password</span>
              <input
                type="password" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          ) : null}

          <button
            className="btn btn-primary btn-lg"
            disabled={busy || !email.trim() || (usingLiveBackend && !password)}
            type="submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {usingLiveBackend ? null : (
          <div className="demo-note rise" style={{ animationDelay: "200ms" }}>
            <p className="label">Demo accounts</p>
            <ul className="demo-list">
              <li><code>maya@northgate.test</code> — reports a problem</li>
              <li><code>jordan@northgate.test</code> — runs the IT desk</li>
              <li><code>sam@northgate.test</code> — edits the questions</li>
            </ul>
            <p className="hint">
              No password needed here. Connect Supabase and this becomes a real sign-in.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
