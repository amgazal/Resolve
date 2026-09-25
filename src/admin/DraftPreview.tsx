import { useState } from "react";
import type { DiagnosisSummary, EditableTree } from "@/types";

/** Local simulation only: never creates a diagnostic session or ticket. */
export function DraftPreview({ tree, diagnoses, onClose }: { tree: EditableTree; diagnoses: DiagnosisSummary[]; onClose: () => void }) {
  const [nodeId, setNodeId] = useState(tree.rootNodeId);
  const [diagnosisId, setDiagnosisId] = useState<string | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const node = tree.nodes.find(n => n.id === nodeId);
  const loop = Boolean(nodeId && visited.includes(nodeId));
  return <section className="cardlet preview" aria-label="Draft preview">
    <p className="label">Preview / test mode · v{tree.version}</p>
    <p className="hint">Try the saved questions. This does not create a support session or ticket.</p>
    {diagnosisId ? <h2 className="col-title">{diagnoses.find(d => d.id === diagnosisId)?.shortLabel ?? "Unknown diagnosis"}</h2>
      : loop ? <p role="alert">This branch loops back to an earlier question.</p>
      : node ? <><h2 className="col-title">{node.question}</h2><div className="row">{node.options.map(o =>
        <button key={o.id} className="btn" onClick={() => { setVisited([...visited, node.id]); setNodeId(o.nextNodeId); setDiagnosisId(o.diagnosisId); }}>{o.label}</button>)}</div>
        {!node.options.length ? <p>No answers have been added to this question.</p> : null}</>
      : <p>No question is available on this branch.</p>}
    <div className="row"><button className="btn" onClick={() => { setNodeId(tree.rootNodeId); setDiagnosisId(null); setVisited([]); }}>Restart preview</button>
      <button className="btn" onClick={onClose}>Exit preview</button></div>
  </section>;
}
