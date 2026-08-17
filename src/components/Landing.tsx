import type { Catalog } from "@/types";
import { Icon } from "./Icon";

export function Landing({
  catalog, description, setDescription, categoryId, setCategoryId,
  device, setDevice, os, setOs, onStart, busy, firstName,
}: {
  catalog: Catalog;
  description: string;
  setDescription: (v: string) => void;
  categoryId: string | null;
  setCategoryId: (v: string) => void;
  device: string;
  setDevice: (v: string) => void;
  os: string;
  setOs: (v: string) => void;
  onStart: () => void;
  busy: boolean;
  firstName: string;
}) {
  return (
    <div className="landing">
      <div className="landing-col">
        <p className="greeting rise">Hello {firstName} — you've reached the right place.</p>
        <h1 className="display rise" style={{ animationDelay: "60ms" }}>What's going wrong?</h1>
        <p className="lede rise" style={{ animationDelay: "100ms" }}>
          Describe it however you'd say it out loud. We'll ask a few short questions, walk
          through the likely fixes with you, and bring in a technician only if we need to.
        </p>

        <div className="writebox rise" style={{ animationDelay: "150ms" }}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="My laptop connects to Wi-Fi but websites won't load."
            aria-label="Describe the problem"
          />
        </div>

        <p className="label label-gap rise" style={{ animationDelay: "190ms" }}>
          Which of these is closest?
        </p>
        <div className="cats rise" style={{ animationDelay: "210ms" }}>
          {catalog.categories.map((c) => (
            <button
              key={c.id}
              className={`cat${categoryId === c.id ? " on" : ""}`}
              onClick={() => setCategoryId(c.id)}
              aria-pressed={categoryId === c.id}
            >
              <span className="cat-icon"><Icon name={c.icon} size={19} /></span>
              <span className="cat-label">{c.label}</span>
              <span className="cat-hint">{c.hint}</span>
            </button>
          ))}
        </div>

        <div className="context rise" style={{ animationDelay: "250ms" }}>
          <label className="picker">
            <span>Device</span>
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {catalog.devices.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>
          <label className="picker">
            <span>System</span>
            <select value={os} onChange={(e) => setOs(e.target.value)}>
              {catalog.systems.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="cta rise" style={{ animationDelay: "290ms" }}>
          <button className="btn btn-primary btn-lg" disabled={!categoryId || busy} onClick={onStart}>
            {busy ? "One moment…" : "Start"}
            {busy ? null : <Icon name="arrow" size={18} />}
          </button>
          {!categoryId ? <span className="hint">Pick the closest match to begin.</span> : null}
        </div>

        <ul className="assurances rise" style={{ animationDelay: "330ms" }}>
          <li><span className="assurance-k">Short by design</span>A few focused questions, one at a time.</li>
          <li><span className="assurance-k">Nothing is sent yet</span>You review the handoff before it reaches IT.</li>
          <li><span className="assurance-k">No repeating yourself</span>If it needs escalation, your answers and attempted fixes go with the ticket.</li>
        </ul>
      </div>
    </div>
  );
}
