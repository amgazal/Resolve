import type { SessionState } from "@/types";
import { Icon } from "./Icon";
import { handoffConfirmation } from "@/api/requesterPresentation";
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
  reference, canSeeQueue, onView, onDone, onRequests, session, imageFailure,
}: {
  session: SessionState;
  imageFailure?: boolean;
  onRequests: () => void;
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
          Your request is <strong className="ref">{reference}</strong>. {handoffConfirmation(session)}
        </p>
        {imageFailure ? <p className="reply-callout" role="alert">Your request was sent, but the screenshots could not be attached. Open My requests to retry attaching them. Your selected images are kept in this tab until you retry, start over, or reload.</p> : null}
        <div className="row row-center">
          <button className="btn btn-primary" onClick={onRequests}>View my requests</button>
          {canSeeQueue ? (
            <button className="btn btn-primary" onClick={onView}>
              See it in the IT desk<Icon name="arrow" size={17} />
            </button>
          ) : null}
          <button className="btn btn-plain" onClick={onDone}>
            Report something else
          </button>
        </div>
      </div>
    </div>
  );
}
