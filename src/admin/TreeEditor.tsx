import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, DiagnosisSummary, EditableNode, EditableOption, EditableTree } from "@/types";
import { confirmLeave, hasUnsavedChanges, useUnsavedChanges } from "@/unsaved";
import { api } from "@/api";
import { Icon } from "@/components/Icon";

/**
 * The tree editor.
 *
 * This is what makes the trees content rather than code. An admin picks a
 * category, edits a draft, and publishes — no deploy, no developer.
 *
 * Two rules do the heavy lifting, and both are enforced in the database
 * as well as here, because a UI guard is a courtesy and a constraint is a
 * guarantee:
 *
 *   · Every answer leads somewhere — another question, or a diagnosis.
 *   · Publishing is refused if any question is unreachable or unanswerable.
 *
 * Editing never touches the live tree. Opening a draft clones the
 * published version, so people mid-diagnosis keep the questions they
 * started with, and old tickets keep explaining themselves in the wording
 * that was actually used.
 */

type Target = { kind: "node"; id: string } | { kind: "dx"; id: string } | null;

const targetValue = (o: { nextNodeId: string | null; diagnosisId: string | null }) =>
  o.nextNodeId ? `node:${o.nextNodeId}` : o.diagnosisId ? `dx:${o.diagnosisId}` : "";

const parseTarget = (v: string): Target => {
  if (v.startsWith("node:")) return { kind: "node", id: v.slice(5) };
  if (v.startsWith("dx:")) return { kind: "dx", id: v.slice(3) };
  return null;
};

export function TreeEditor({
  categories, flash, onError,
}: {
  categories: Category[];
  flash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(categories[0]?.id ?? null);
  const [tree, setTree] = useState<EditableTree | null>(null);
  const [diagnoses, setDiagnoses] = useState<DiagnosisSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const lock = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    api.getDiagnosisOptions().then(setDiagnoses).catch((e: Error) => onError(e.message));
  }, [onError]);

  const openDraft = useCallback(
    (id: string) => {
      const request = ++requestId.current;
      setLoading(true);
      setTree(null);
      api.openDraft(id)
        .then((value) => { if (request === requestId.current) setTree(value); })
        .catch((e: Error) => { if (request === requestId.current) onError(e.message); })
        .finally(() => { if (request === requestId.current) setLoading(false); });
    },
    [onError]
  );

  useEffect(() => { if (categoryId) openDraft(categoryId); return () => { requestId.current++; }; }, [categoryId, openDraft]);

  async function run(fn: () => Promise<EditableTree>, msg?: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      setTree(await fn());
      if (msg) flash(msg);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const nodeById = useMemo(
    () => Object.fromEntries((tree?.nodes ?? []).map((n) => [n.id, n])),
    [tree]
  );
  const dxById = useMemo(
    () => Object.fromEntries(diagnoses.map((d) => [d.id, d])),
    [diagnoses]
  );

  /** A readable outline of the whole flow, rebuilt on every edit. */
  const outline = useMemo(() => {
    if (!tree || !tree.rootNodeId) return "Set a first question to see the flow.";
    const lines: string[] = [];
    const seen = new Set<string>();

    const walk = (nodeId: string, depth: number) => {
      const node = nodeById[nodeId];
      if (!node) return;
      const pad = "  ".repeat(depth);
      if (seen.has(nodeId)) { lines.push(`${pad}${node.shortLabel} ↳ already shown`); return; }
      seen.add(nodeId);
      lines.push(`${pad}${node.shortLabel}`);
      node.options.forEach((o, i) => {
        const last = i === node.options.length - 1;
        const branch = `${pad}${last ? "└─" : "├─"} ${o.label}`;
        if (o.diagnosisId) {
          lines.push(`${branch} → ${dxById[o.diagnosisId]?.nodeLabel ?? "unknown"}`);
        } else if (o.nextNodeId) {
          lines.push(branch);
          walk(o.nextNodeId, depth + 1);
        } else {
          lines.push(`${branch} → (nowhere yet)`);
        }
      });
    };

    lines.push(tree.rootLabel);
    walk(tree.rootNodeId, 0);
    return lines.join("\n");
  }, [tree, nodeById, dxById]);

  const orphans = useMemo(() => {
    if (!tree?.rootNodeId) return [];
    const reachable = new Set<string>([tree.rootNodeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of tree.nodes) {
        if (!reachable.has(n.id)) continue;
        for (const o of n.options) {
          if (o.nextNodeId && !reachable.has(o.nextNodeId)) { reachable.add(o.nextNodeId); grew = true; }
        }
      }
    }
    return tree.nodes.filter((n) => !reachable.has(n.id));
  }, [tree]);


  const cycleNodes = useMemo(() => {
    if (!tree) return [] as EditableNode[];
    const byId = new Map(tree.nodes.map((node) => [node.id, node]));
    const done = new Set<string>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const inCycle = new Set<string>();

    const visit = (nodeId: string) => {
      if (done.has(nodeId)) return;
      const node = byId.get(nodeId);
      if (!node) return;

      onStack.add(nodeId);
      stack.push(nodeId);
      for (const option of node.options) {
        const next = option.nextNodeId;
        if (!next) continue;
        if (onStack.has(next)) {
          const start = stack.indexOf(next);
          stack.slice(start).forEach((id) => inCycle.add(id));
        } else {
          visit(next);
        }
      }
      stack.pop();
      onStack.delete(nodeId);
      done.add(nodeId);
    };

    for (const node of tree.nodes) visit(node.id);
    return tree.nodes.filter((node) => inCycle.has(node.id));
  }, [tree]);

  const unanswered = tree?.nodes.filter((node) => node.options.length === 0) ?? [];
  const canPublish = Boolean(
    tree?.rootNodeId && unanswered.length === 0 && orphans.length === 0 && cycleNodes.length === 0,
  );

  return (
    <div className="editor">
      <header className="desk-head">
        <div>
          <p className="label">Question editor</p>
          <h1 className="col-title">Change what Resolve asks, without changing the app.</h1>
          <p className="hint">
            You're editing a draft. Nothing here reaches anyone until you publish it.
          </p>
        </div>
        <div className="editor-pick">
          <label className="picker">
            <span>Category</span>
            <select value={categoryId ?? ""} disabled={busy || loading} onChange={(e) => { if (confirmLeave()) setCategoryId(e.target.value); }}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {tree ? (
            <span className={`draft-chip is-${tree.status}`}>
              v{tree.version} · {tree.status}
            </span>
          ) : null}
        </div>
      </header>

      {loading ? <div className="loading">Opening the draft…</div> : null}

      {tree ? (
        <div className="editor-body">
          <div className="editor-main">
            {tree.nodes.length === 0 ? (
              <div className="empty">
                <p className="said">No questions yet.</p>
                <p className="hint">Add the first one and it becomes the opening question.</p>
              </div>
            ) : null}

            {tree.nodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                tree={tree}
                diagnoses={diagnoses}
                isRoot={tree.rootNodeId === node.id}
                isOrphan={orphans.some((o) => o.id === node.id)}
                busy={busy || tree.status !== "draft"}
                onSaveNode={(patch) => run(() => api.saveNode(tree.id, { id: node.id, ...patch }))}
                onDeleteNode={() => { if (window.confirm("Remove this question and its answers? Unsaved edits to it will be lost.")) void run(() => api.deleteNode(tree.id, node.id), "Question removed"); }}
                onSetRoot={() => run(() => api.setRootNode(tree.id, node.id), "Now the first question")}
                onSaveOption={(option) => run(() => api.saveOption(tree.id, node.id, option))}
                onDeleteOption={(id) => { if (window.confirm("Remove this answer branch?")) void run(() => api.deleteOption(tree.id, node.id, id), "Answer removed"); }}
              />
            ))}

            <button
              className="btn btn-dashed"
              disabled={busy || tree.status !== "draft"}
              onClick={() => run(
                () => api.saveNode(tree.id, {
                  question: "New question",
                  factLabel: "Detail",
                  shortLabel: "New question",
                }),
                "Question added")}
            >
              <Icon name="plus" size={16} />Add a question
            </button>
          </div>

          <aside className="editor-side">
            <div className="cardlet">
              <p className="label">The flow</p>
              <pre className="outline" tabIndex={0} aria-label="Diagnostic flow outline">{outline}</pre>
            </div>

            <div className="cardlet">
              <p className="label">Before publishing</p>
              <ul className="checklist">
                <li className={tree.rootNodeId ? "ok" : "todo"}>
                  {tree.rootNodeId ? "First question set" : "No first question yet"}
                </li>
                <li className={unanswered.length === 0 ? "ok" : "todo"}>
                  {unanswered.length === 0
                    ? "Every question has answers"
                    : `No answers yet: ${unanswered.map((node) => node.shortLabel).join(", ")}`}
                </li>
                <li className={orphans.length === 0 ? "ok" : "todo"}>
                  {orphans.length === 0
                    ? "Every question is reachable"
                    : `Unreachable: ${orphans.map((o) => o.shortLabel).join(", ")}`}
                </li>
                <li className={cycleNodes.length === 0 ? "ok" : "todo"}>
                  {cycleNodes.length === 0
                    ? "No loops in the flow"
                    : `Loop detected around: ${cycleNodes.map((node) => node.shortLabel).join(", ")}`}
                </li>
              </ul>
              {tree.status === "published" ? (
                <button
                  className="btn publish"
                  disabled={busy || !categoryId}
                  onClick={() => { if (categoryId) openDraft(categoryId); }}
                >
                  Start the next version
                </button>
              ) : (
                <button
                  className="btn btn-primary publish"
                  disabled={busy || !canPublish}
                  onClick={() => {
                    if (hasUnsavedChanges()) { onError("Save or discard your edits before publishing."); return; }
                    if (window.confirm("Publish this version? New sessions will use these questions. Existing sessions keep their original version.")) void run(() => api.publishTree(tree.id), "Published — this is live now");
                  }}
                >
                  Publish this version
                </button>
              )}
              <p className="hint">
                Publishing retires the previous version. Sessions already running keep the
                questions they started with.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ one question ---------------------------- */

function NodeCard({
  node, tree, diagnoses, isRoot, isOrphan, busy,
  onSaveNode, onDeleteNode, onSetRoot, onSaveOption, onDeleteOption,
}: {
  node: EditableNode;
  tree: EditableTree;
  diagnoses: DiagnosisSummary[];
  isRoot: boolean;
  isOrphan: boolean;
  busy: boolean;
  onSaveNode: (patch: Partial<EditableNode>) => void;
  onDeleteNode: () => void;
  onSetRoot: () => void;
  onSaveOption: (option: { id?: string; label: string; factValue: string; nextNodeId: string | null; diagnosisId: string | null; position?: number }) => void;
  onDeleteOption: (id: string) => void;
}) {
  const [draft, setDraft] = useState({
    question: node.question, factLabel: node.factLabel, shortLabel: node.shortLabel,
  });

  useEffect(() => {
    setDraft({ question: node.question, factLabel: node.factLabel, shortLabel: node.shortLabel });
  }, [node.question, node.factLabel, node.shortLabel]);

  const dirty =
    draft.question !== node.question ||
    draft.factLabel !== node.factLabel ||
    draft.shortLabel !== node.shortLabel;

  useUnsavedChanges(dirty);

  return (
    <fieldset aria-label={node.shortLabel} disabled={busy} className={`nodecard${isOrphan ? " is-orphan" : ""}`}>
      <div className="nodecard-head">
        <div className="nodecard-tags">
          {isRoot ? <span className="tag tag-root">First question</span> : null}
          {isOrphan ? <span className="tag tag-warn">Unreachable</span> : null}
        </div>
        <div className="nodecard-tools">
          {!isRoot ? (
            <button className="btn btn-plain btn-sm" disabled={busy} onClick={onSetRoot}>
              Make first
            </button>
          ) : null}
          <button
            className="btn btn-plain btn-sm"
            disabled={busy || isRoot}
            onClick={onDeleteNode}
            aria-label={isRoot ? "Choose another first question before removing this one" : "Remove this question"}
            title={isRoot ? "Choose another first question before removing this one" : undefined}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      <label className="field">
        <span className="label">Question shown to the user</span>
        <textarea
          rows={2}
          maxLength={2000}
          value={draft.question}
          onChange={(e) => setDraft({ ...draft, question: e.target.value })}
        />
      </label>

      <div className="field-pair">
        <label className="field">
          <span className="label">Row label in "What we know"</span>
          <input
            maxLength={200} value={draft.factLabel}
            onChange={(e) => setDraft({ ...draft, factLabel: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="label">Short label on the trail</span>
          <input
            maxLength={200} value={draft.shortLabel}
            onChange={(e) => setDraft({ ...draft, shortLabel: e.target.value })}
          />
        </label>
      </div>

      {dirty ? (
        <div className="row row-tight">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSaveNode(draft)}>
            Save question
          </button>
          <button
            className="btn btn-plain btn-sm"
            onClick={() => setDraft({
              question: node.question, factLabel: node.factLabel, shortLabel: node.shortLabel,
            })}
          >
            Discard
          </button>
        </div>
      ) : null}

      <p className="hlabel answers-head">Answers</p>
      <ul className="answers">
        {node.options.map((o) => (
          <OptionDraft key={o.id} option={o} node={node} tree={tree} diagnoses={diagnoses}
            busy={busy} onSave={onSaveOption} onDelete={() => onDeleteOption(o.id)} />
        ))}
      </ul>

      <button
        className="btn btn-dashed btn-sm"
        disabled={busy || diagnoses.length === 0}
        onClick={() => onSaveOption({
          label: "New answer",
          factValue: "Recorded",
          nextNodeId: null,
          diagnosisId: diagnoses[0]?.id ?? null,
          position: node.options.length,
        })}
      >
        <Icon name="plus" size={14} />Add an answer
      </button>
      {node.options.length === 0 ? (
        <p className="hint warn">A question with no answers is a dead end. Add at least one.</p>
      ) : null}
    </fieldset>
  );
}


function OptionDraft({ option, node, tree, diagnoses, busy, onSave, onDelete }: {
  option: EditableOption; node: EditableNode; tree: EditableTree; diagnoses: DiagnosisSummary[];
  busy: boolean; onSave: (option: EditableOption) => void; onDelete: () => void;
}) {
  const [draft, setDraft] = useState(option);
  useEffect(() => { setDraft(option); }, [option.label, option.factValue, option.nextNodeId, option.diagnosisId]);
  const dirty = draft.label !== option.label || draft.factValue !== option.factValue || targetValue(draft) !== targetValue(option);
  useUnsavedChanges(dirty);
  return <li>
    <input className="ans-label" aria-label="Answer text" maxLength={500} value={draft.label}
      onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
    <input className="ans-fact" aria-label="What this records" maxLength={1000} value={draft.factValue}
      onChange={(e) => setDraft({ ...draft, factValue: e.target.value })} />
    <select className="ans-target" aria-label="Where this answer leads" value={targetValue(draft)}
      onChange={(e) => { const t = parseTarget(e.target.value); setDraft({ ...draft,
        nextNodeId: t?.kind === "node" ? t.id : null, diagnosisId: t?.kind === "dx" ? t.id : null }); }}>
      <optgroup label="Ask another question">{tree.nodes.filter((n) => n.id !== node.id).map((n) =>
        <option key={n.id} value={`node:${n.id}`}>{n.shortLabel}</option>)}</optgroup>
      <optgroup label="Conclude with">{diagnoses.map((d) =>
        <option key={d.id} value={`dx:${d.id}`}>{d.shortLabel}</option>)}</optgroup>
    </select>
    <button className="btn btn-plain btn-sm" disabled={busy} onClick={onDelete} aria-label="Remove this answer"><Icon name="close" size={14} /></button>
    {dirty ? <div className="answer-actions">
      <button className="btn btn-primary btn-sm" disabled={busy || !draft.label.trim() || !draft.factValue.trim()} onClick={() => onSave(draft)}>Save answer</button>
      <button className="btn btn-plain btn-sm" disabled={busy} onClick={() => setDraft(option)}>Discard answer</button>
      <span className="hint" role="status">Unsaved answer</span>
    </div> : null}
  </li>;
}
