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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!usingLiveBackend) return (
    <div className="landing"><div className="landing-col signin">
      <p className="greeting">A guided path from problem to resolution.</p>
      <h1 className="display">Explore Resolve as</h1>
      <div className="persona-list">
        {[
          ["Requester", "maya", "Describe a problem and try a guided fix."],
          ["IT Technician", "jordan", "Review tickets with the diagnostic history attached."],
          ["Administrator", "sam", "Edit and publish a version of the questions."],
        ].map(([role, name, detail]) => (
          <button className="persona" key={name} disabled={busy}
            onClick={() => onSubmit(`${name}@northgate.test`, "")}>
            <strong>{role}</strong><span>{detail}</span>
          </button>
        ))}
      </div>
      <p className="hint">Demo data resets when you reload. Switch roles from the header.</p>
    </div></div>
  );

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
            if (!busy && email.trim() && password) {
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

            <label className="field">
              <span className="label">Password</span>
              <input
                type="password" value={password} autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

          <button
            className="btn btn-primary btn-lg"
            disabled={busy || !email.trim() || !password}
            type="submit"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>


      </div>
    </div>
  );
}
