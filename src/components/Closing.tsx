import type { SessionState } from "@/types";
import { Icon } from "./Icon";
import { Trail } from "./Trail";

export function Resolved({ session, onDone }: { session: SessionState; onDone: () => void }) {
  const last = session.attempts[session.attempts.length - 1];
  return (
    <div className="closing">
      <div className="closing-col rise">
        <span className="seal" aria-hidden="true"><Icon name="check" size={20} /></span>
        <h1 className="display display-sm">That's sorted.</h1>
        <p className="lede">
          {last ? `"${last.title}" did it. ` : ""}
          We've recorded what worked in this session. You're all set.
        </p>
        <div className="closing-trail"><Trail nodes={session.path} /></div>
        <div className="row row-center">
          <button className="btn btn-primary" onClick={onDone}>Report something else</button>
        </div>
      </div>
    </div>
  );
}

export function Sent({
  reference, canSeeQueue, onView, onDone,
}: {
  reference: string;
  canSeeQueue: boolean;
  onView: () => void;
  onDone: () => void;
}) {
  return (
    <div className="closing">
      <div className="closing-col rise">
        <span className="seal" aria-hidden="true"><Icon name="arrow" size={20} /></span>
        <h1 className="display display-sm">On its way.</h1>
        <p className="lede">
          Your request is <strong className="ref">{reference}</strong>. A technician picks it up with
          your full diagnostic history attached — so nobody will ask whether you've tried turning it
          off and on again.
        </p>
        <div className="row row-center">
          {canSeeQueue ? (
            <button className="btn btn-primary" onClick={onView}>
              See it in the IT desk<Icon name="arrow" size={17} />
            </button>
          ) : null}
          <button className={canSeeQueue ? "btn btn-plain" : "btn btn-primary"} onClick={onDone}>
            Report something else
          </button>
        </div>
      </div>
    </div>
  );
}
