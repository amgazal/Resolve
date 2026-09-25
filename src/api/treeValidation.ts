import type { EditableTree, TreeValidation } from '@/types';

/** Mock adapter equivalent of validate_tree; the live editor consumes SQL results. */
export function validateMockTree(tree: EditableTree, diagnosisIds: Set<string>): TreeValidation {
  const issues: TreeValidation['issues'] = [];
  const nodes = new Map(tree.nodes.map(n => [n.id, n]));
  const add = (code: string, message: string, nodeId?: string) => issues.push({ code, message, nodeId });
  if (!tree.rootNodeId || !nodes.has(tree.rootNodeId)) add('root', 'Set a first question in this tree.');
  for (const node of tree.nodes) {
    if (!node.options.length) add('unanswered', `No answers: ${node.shortLabel}`, node.id);
    for (const o of node.options) {
      if (Boolean(o.nextNodeId) === Boolean(o.diagnosisId) ||
        (o.nextNodeId && !nodes.has(o.nextNodeId)) || (o.diagnosisId && !diagnosisIds.has(o.diagnosisId))) {
        add('target', `Invalid answer destination: ${node.shortLabel}`, node.id);
      }
    }
  }
  const reachable = new Set<string>();
  function visit(id: string) {
    if (reachable.has(id)) return;
    reachable.add(id);
    nodes.get(id)?.options.forEach(o => { if (o.nextNodeId) visit(o.nextNodeId); });
  }
  if (tree.rootNodeId) visit(tree.rootNodeId);
  tree.nodes.filter(n => !reachable.has(n.id)).forEach(n => add('unreachable', `Unreachable: ${n.shortLabel}`, n.id));
  const done = new Set<string>(), visiting = new Set<string>(), cycles = new Set<string>();
  function cycle(id: string) {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (done.has(id)) return;
    visiting.add(id);
    nodes.get(id)?.options.forEach(o => { if (o.nextNodeId) cycle(o.nextNodeId); });
    visiting.delete(id); done.add(id);
  }
  tree.nodes.forEach(n => cycle(n.id));
  cycles.forEach(id => add('cycle', `Loop: ${nodes.get(id)?.shortLabel}`, id));
  return { valid: issues.length === 0, issues };
}
