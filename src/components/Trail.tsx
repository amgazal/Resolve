import type { TrailNode } from "@/types";

/**
 * The signature element: the route from a vague complaint to a named
 * cause. A filled dot is something we know, a ringed dot is the question
 * on screen, a dashed one is the answer we haven't reached yet.
 *
 * The same component renders on the user's side and in the technician's
 * panel, which is the whole argument of the product — they are looking at
 * one artefact, not a request and a separate reply.
 */
export function Trail({ nodes }: { nodes: TrailNode[] }) {
  return (
    <ol className="trail">
      {nodes.map((n, i) => (
        <li key={i} className={`tnode is-${n.state}${n.terminal ? " is-end" : ""}`}>
          <span className="tnode-dot" aria-hidden="true" />
          <span className="tnode-text">
            <span className="tnode-label">{n.label}</span>
            {n.answer ? <span className="tnode-answer">{n.answer}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
