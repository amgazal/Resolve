/**
 * In-memory adapter.
 *
 * Implements the same `Api` contract as the Supabase client, including
 * traversal rules and role checks, so the app is fully explorable with no
 * database. State lives in module memory and resets on reload — that is
 * the honest limitation, and exactly the one the real backend removes.
 */

import type {
  Api, AttemptOutcome, Catalog, Diagnosis, DiagnosisSummary, EditableNode,
  EditableOption, EditableTree, Fact, Priority, Profile, Question, QueueStats,
  SavedRoute, SessionState, Step, TicketDetail, TicketRow, TicketStatus, TrailNode,
} from "@/types";
import { CATEGORIES, DEVICES, SYSTEMS } from "@/data/categories";
import { DIAGNOSES } from "@/data/diagnoses";
import { TREES } from "@/data/trees";

/* ------------------------------- storage -------------------------------- */

interface MNode { id: string; treeId: string; key: string; question: string; factLabel: string; shortLabel: string; position: number; optionIds: string[] }
interface MOption { id: string; nodeId: string; label: string; factValue: string; position: number; nextNodeId: string | null; diagnosisId: string | null }
interface MTree { id: string; categoryId: string; version: number; status: "draft" | "published" | "archived"; rootLabel: string; rootNodeId: string | null }
interface MDiagnosis { id: string; key: string; title: string; shortLabel: string; nodeLabel: string; priority: Priority; stepIds: string[] }
interface MSession { id: string; userId: string; categoryId: string; treeId: string; description: string; device: string | null; operatingSystem: string | null; currentNodeId: string | null; diagnosisId: string | null; status: SessionState["status"]; answers: { nodeId: string; optionId: string }[]; attempts: { stepId: string; outcome: AttemptOutcome }[] }
interface MTicket { id: string; sessionId: string; reference: string; requesterId: string; requester: string; assignee: string | null; categoryId: string; categoryLabel: string; categoryShort: string; diagnosisId: string | null; diagnosisLabel: string | null; subject: string; userNote: string; priority: Priority; status: TicketStatus; createdAt: string; notes: { author: string; body: string; createdAt: string }[] }

let seq = 1;
const uid = (p: string) => `${p}_${seq++}`;

const categories: Record<string, { id: string; slug: string; label: string; shortLabel: string; hint: string; icon: string; position: number; treeIds: string[] }> = {};
const trees: Record<string, MTree> = {};
const nodes: Record<string, MNode> = {};
const options: Record<string, MOption> = {};
const diagnoses: Record<string, MDiagnosis> = {};
const steps: Record<string, Step> = {};
const sessions: Record<string, MSession> = {};
const tickets: MTicket[] = [];
let routes: SavedRoute[] = [];
let refCounter = 2481;

/* --------------------------- who is signed in --------------------------- */

const PEOPLE: Record<string, Profile> = {
  "maya@northgate.test":  { id: "u_maya",   fullName: "Maya Okafor",  email: "maya@northgate.test",   role: "end_user" },
  "jordan@northgate.test": { id: "u_jordan", fullName: "Jordan Ellis", email: "jordan@northgate.test", role: "technician" },
  "sam@northgate.test":   { id: "u_sam",    fullName: "Sam Adeyemi",  email: "sam@northgate.test",    role: "admin" },
};

let current: Profile | null = PEOPLE["maya@northgate.test"]!;

/* ------------------------------- seeding -------------------------------- */

for (const [key, d] of Object.entries(DIAGNOSES)) {
  const id = uid("dx");
  diagnoses[id] = { id, key, title: d.title, shortLabel: d.short, nodeLabel: d.node, priority: d.priority, stepIds: [] };
  d.steps.forEach(([title, detail], i) => {
    const sid = uid("st");
    steps[sid] = { id: sid, position: i + 1, title, detail };
    diagnoses[id]!.stepIds.push(sid);
  });
}
const dxByKey = (key: string) => Object.values(diagnoses).find((d) => d.key === key)!;

CATEGORIES.forEach((c, i) => {
  const catId = uid("cat");
  categories[catId] = { id: catId, ...c, position: i, treeIds: [] };
  const spec = TREES[c.slug]!;
  const treeId = uid("tree");
  const byKey: Record<string, string> = {};

  Object.entries(spec.nodes).forEach(([key, n], pos) => {
    const nid = uid("node");
    nodes[nid] = { id: nid, treeId, key, question: n[0], factLabel: n[1], shortLabel: n[2], position: pos, optionIds: [] };
    byKey[key] = nid;
  });

  Object.entries(spec.nodes).forEach(([key, n]) => {
    n[3].forEach(([label, factValue, target], pos) => {
      const oid = uid("opt");
      options[oid] = {
        id: oid, nodeId: byKey[key]!, label, factValue, position: pos,
        nextNodeId: target.startsWith("node:") ? byKey[target.slice(5)]! : null,
        diagnosisId: target.startsWith("dx:") ? dxByKey(target.slice(3)).id : null,
      };
      nodes[byKey[key]!]!.optionIds.push(oid);
    });
  });

  trees[treeId] = { id: treeId, categoryId: catId, version: 1, status: "published", rootLabel: spec.rootLabel, rootNodeId: byKey[spec.root]! };
  categories[catId]!.treeIds.push(treeId);
});

const publishedTree = (categoryId: string) =>
  Object.values(trees).find((t) => t.categoryId === categoryId && t.status === "published");

/* ------------------------------ projections ----------------------------- */

const wireQuestion = (id: string): Question => {
  const n = nodes[id]!;
  return {
    id: n.id, key: n.key, question: n.question, factLabel: n.factLabel, shortLabel: n.shortLabel,
    options: n.optionIds.map((o) => ({ id: o, label: options[o]!.label })),
  };
};

const wireDiagnosis = (id: string): Diagnosis => {
  const d = diagnoses[id]!;
  return { ...d, steps: d.stepIds.map((s) => steps[s]!) };
};

function state(sessionId: string): SessionState {
  const s = sessions[sessionId]!;
  const tree = trees[s.treeId]!;
  const facts: Fact[] = s.answers.map((a) => ({
    label: nodes[a.nodeId]!.factLabel, value: options[a.optionId]!.factValue,
  }));

  const path: TrailNode[] = [{ label: tree.rootLabel, answer: null, state: "known" }];
  s.answers.forEach((a) =>
    path.push({ label: nodes[a.nodeId]!.shortLabel, answer: options[a.optionId]!.label, state: "known" }));
  if (s.currentNodeId) path.push({ label: nodes[s.currentNodeId]!.shortLabel, answer: null, state: "current" });
  path.push(s.diagnosisId
    ? { label: diagnoses[s.diagnosisId]!.nodeLabel, answer: null, state: "known", terminal: true }
    : { label: "Diagnosis", answer: null, state: "unknown", terminal: true });

  return {
    id: s.id, description: s.description, device: s.device, operatingSystem: s.operatingSystem,
    categoryLabel: categories[s.categoryId]!.label, status: s.status, facts, path,
    attempts: s.attempts.map((a) => ({ stepId: a.stepId, title: steps[a.stepId]!.title, outcome: a.outcome })),
    node: s.currentNodeId ? wireQuestion(s.currentNodeId) : null,
    diagnosis: s.diagnosisId ? wireDiagnosis(s.diagnosisId) : null,
  };
}

const editableTree = (treeId: string): EditableTree => {
  const t = trees[treeId]!;
  return {
    id: t.id, categoryId: t.categoryId, version: t.version, status: t.status,
    rootLabel: t.rootLabel, rootNodeId: t.rootNodeId,
    nodes: Object.values(nodes)
      .filter((n) => n.treeId === treeId)
      .sort((a, b) => a.position - b.position)
      .map<EditableNode>((n) => ({
        id: n.id, key: n.key, question: n.question, factLabel: n.factLabel,
        shortLabel: n.shortLabel, position: n.position,
        options: n.optionIds.map<EditableOption>((o) => ({ ...options[o]! })),
      })),
  };
};

/* -------------------------------- helpers ------------------------------- */

const wait = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 110));
const fail = (msg: string): never => { throw new Error(msg); };
const me = () => current ?? fail("Sign in to continue");
const staff = () => { const p = me(); if (p.role === "end_user") fail("The IT desk is for technicians"); return p; };
const admin = () => { const p = me(); if (p.role !== "admin") fail("Only admins can edit trees"); return p; };
const mine = (s: MSession) => { if (s.userId !== me().id) fail("Not your session"); return s; };
const draftTree = (treeId: string) => {
  const tree = trees[treeId] ?? fail("Tree not found");
  if (tree.status !== "draft") fail("Only draft questions can be edited");
  return tree;
};
const nodeInDraft = (treeId: string, nodeId: string) => {
  draftTree(treeId);
  const node = nodes[nodeId] ?? fail("Question not found");
  if (node.treeId !== treeId) fail("That question does not belong to this draft");
  return node;
};

/* --------------------------- demo queue content -------------------------- */

function replay(args: {
  who: Profile; slug: string; device: string; os: string; description: string;
  answers: string[]; attempted: number; note: string; status?: TicketStatus;
  assignee?: string; minutes: number;
}) {
  const cat = Object.values(categories).find((c) => c.slug === args.slug)!;
  const tree = publishedTree(cat.id)!;
  const s: MSession = {
    id: uid("ses"), userId: args.who.id, categoryId: cat.id, treeId: tree.id,
    description: args.description, device: args.device, operatingSystem: args.os,
    currentNodeId: tree.rootNodeId, diagnosisId: null, status: "in_progress", answers: [], attempts: [],
  };
  sessions[s.id] = s;

  for (const label of args.answers) {
    if (!s.currentNodeId) break;
    const oid = nodes[s.currentNodeId]!.optionIds.find((o) => options[o]!.label === label)!;
    s.answers.push({ nodeId: s.currentNodeId, optionId: oid });
    s.currentNodeId = options[oid]!.nextNodeId;
    s.diagnosisId = options[oid]!.diagnosisId;
  }

  const d = diagnoses[s.diagnosisId!]!;
  d.stepIds.slice(0, args.attempted).forEach((stepId) => s.attempts.push({ stepId, outcome: "failed" }));
  s.status = "escalated";

  tickets.push({
    id: uid("tkt"), sessionId: s.id, reference: `RSV-${refCounter++}`,
    requesterId: args.who.id, requester: args.who.fullName, assignee: args.assignee ?? null,
    categoryId: cat.id, categoryLabel: cat.label, categoryShort: cat.shortLabel,
    diagnosisId: d.id, diagnosisLabel: d.shortLabel, subject: d.title.replace(/\.$/, ""),
    userNote: args.note, priority: d.priority, status: args.status ?? "new",
    createdAt: new Date(Date.now() - args.minutes * 60000).toISOString(), notes: [],
  });
}

replay({ who: PEOPLE["maya@northgate.test"]!, slug: "wifi", device: "Laptop", os: "macOS", minutes: 6,
  description: "My laptop connects to Wi-Fi but websites won't load.",
  answers: ["Yes", "Yes", "All of them", "Nothing changed"], attempted: 3,
  note: "Happens on the third floor only. Worked fine yesterday." });

replay({ who: { id: "u_daniel", fullName: "Daniel Reyes", email: "daniel@northgate.test", role: "end_user" },
  slug: "login", device: "Phone", os: "iOS", minutes: 24,
  description: "It keeps saying my code is wrong even though I just generated it.",
  answers: ["The verification code won't work"], attempted: 2,
  note: "I replaced my phone on Monday.", status: "assigned", assignee: "Jordan Ellis" });

replay({ who: { id: "u_alex", fullName: "Alex Whitfield", email: "alex@northgate.test", role: "end_user" },
  slug: "software", device: "Laptop", os: "Windows", minutes: 63,
  description: "The design app gets to about 60% and then quits.",
  answers: ["While installing", "No"], attempted: 2,
  note: "The error mentions a temp folder.", status: "waiting" });

replay({ who: { id: "u_priya", fullName: "Priya Raman", email: "priya@northgate.test", role: "end_user" },
  slug: "printing", device: "Laptop", os: "macOS", minutes: 142,
  description: "Nothing comes out and the queue just keeps growing.",
  answers: ["Yes", "Yes, they pile up"], attempted: 2,
  note: "Third time this month.", status: "needs_review" });

replay({ who: { id: "u_tom", fullName: "Tom Bergström", email: "tom@northgate.test", role: "end_user" },
  slug: "hardware", device: "Desktop", os: "Windows", minutes: 190,
  description: "My keyboard stopped being recognised after the weekend.",
  answers: ["Yes", "An accessory isn't detected"], attempted: 2,
  note: "It works fine on my colleague's machine.", status: "needs_review" });

routes = [
  { id: "r1", name: "Wi-Fi → Likely DNS", steps: 3, uses: 34 },
  { id: "r2", name: "Login → Stale credentials", steps: 3, uses: 19 },
];

const rowOf = (t: MTicket): TicketRow => ({
  id: t.id, reference: t.reference, requester: t.requester, assignee: t.assignee,
  categoryLabel: t.categoryLabel, categoryShort: t.categoryShort,
  diagnosisLabel: t.diagnosisLabel, subject: t.subject,
  priority: t.priority, status: t.status, createdAt: t.createdAt,
});

/* ------------------------------- the adapter ---------------------------- */

export const mockApi: Api = {
  async getProfile() { return wait(current); },

  async signIn(email) {
    const found = PEOPLE[email.trim().toLowerCase()];
    if (!found) fail("No account with that address. Try maya@, jordan@ or sam@northgate.test");
    current = found!;
    return wait(current);
  },

  async signOut() { current = null; return wait(undefined); },

  async getCatalog(): Promise<Catalog> {
    return wait({
      categories: Object.values(categories)
        .filter((c) => publishedTree(c.id))
        .sort((a, b) => a.position - b.position)
        .map(({ id, slug, label, shortLabel, hint, icon }) => ({ id, slug, label, shortLabel, hint, icon })),
      devices: DEVICES,
      systems: SYSTEMS,
    });
  },

  async startSession({ categoryId, description, device, operatingSystem }) {
    const user = me();
    const tree = publishedTree(categoryId) ?? fail("That category has no published questions yet");
    const id = uid("ses");
    sessions[id] = {
      id, userId: user.id, categoryId, treeId: tree.id, description: description.slice(0, 4000),
      device, operatingSystem, currentNodeId: tree.rootNodeId, diagnosisId: null,
      status: "in_progress", answers: [], attempts: [],
    };
    return wait(state(id));
  },

  async getSession(sessionId) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    return wait(state(s.id));
  },

  async abandonSession(sessionId) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    if (s.status === "in_progress") s.status = "abandoned";
    return wait(undefined);
  },

  async answer(sessionId, optionId) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    if (s.status !== "in_progress") fail("This session is no longer active");
    const currentNodeId = s.currentNodeId;
    if (currentNodeId === null) throw new Error("This diagnosis has already concluded");
    const o = options[optionId];
    if (!o || o.nodeId !== currentNodeId) {
      throw new Error("That answer does not belong to the current question");
    }
    s.answers.push({ nodeId: currentNodeId, optionId });
    s.currentNodeId = o.nextNodeId;
    s.diagnosisId = o.diagnosisId;
    return wait(state(sessionId));
  },

  async undoLastAnswer(sessionId) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    if (s.status !== "in_progress") fail("This session is no longer active");
    if (s.attempts.length) fail("Answers cannot be changed after troubleshooting has started");
    const last = s.answers.pop() ?? fail("There is nothing to undo");
    s.currentNodeId = last.nodeId;
    s.diagnosisId = null;
    return wait(state(sessionId));
  },

  async recordAttempt(sessionId, stepId, outcome) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    if (s.status !== "in_progress") fail("This session is no longer active");
    const diagnosisId = s.diagnosisId;
    if (diagnosisId === null) throw new Error("Reach a diagnosis before recording troubleshooting steps");

    const diagnosis = diagnoses[diagnosisId] ?? fail("Diagnosis not found");
    if (!diagnosis.stepIds.includes(stepId)) fail("That step is not part of this diagnosis");

    const existing = s.attempts.find((a) => a.stepId === stepId);
    if (existing) {
      if (existing.outcome === outcome) return wait(state(sessionId));
      fail("That troubleshooting result is already recorded");
    }

    const expected = diagnosis.stepIds.find((id) => !s.attempts.some((a) => a.stepId === id));
    if (!expected) fail("All troubleshooting steps have already been recorded");
    if (expected !== stepId) fail("Troubleshooting steps must be recorded in order");

    s.attempts.push({ stepId, outcome });
    if (outcome === "fixed") s.status = "resolved";
    return wait(state(sessionId));
  },

  async escalate(sessionId, note) {
    const s = mine(sessions[sessionId] ?? fail("Session not found"));
    if (s.status !== "in_progress") fail("This session is no longer active");
    const diagnosisId = s.diagnosisId;
    if (diagnosisId === null) throw new Error("Complete the diagnostic questions before escalating");
    if (tickets.some((t) => t.sessionId === sessionId)) fail("This has already been sent to IT");
    const d = diagnoses[diagnosisId] ?? fail("Diagnosis not found");
    const cat = categories[s.categoryId]!;
    const t: MTicket = {
      id: uid("tkt"), sessionId, reference: `RSV-${refCounter++}`,
      requesterId: s.userId, requester: me().fullName, assignee: null,
      categoryId: cat.id, categoryLabel: cat.label, categoryShort: cat.shortLabel,
      diagnosisId: d.id, diagnosisLabel: d.shortLabel, subject: d.title.replace(/\.$/, ""),
      userNote: note, priority: d.priority, status: "new",
      createdAt: new Date().toISOString(), notes: [],
    };
    tickets.unshift(t);
    s.status = "escalated";
    return wait({ id: t.id, reference: t.reference });
  },

  async getTickets() { staff(); return wait(tickets.map(rowOf)); },

  async getTicket(id): Promise<TicketDetail> {
    staff();
    const t = tickets.find((x) => x.id === id) ?? fail("Ticket not found");
    const s = state(t!.sessionId);
    return wait({
      ...rowOf(t!),
      description: s.description, device: s.device, operatingSystem: s.operatingSystem,
      userNote: t!.userNote, facts: s.facts, attempts: s.attempts,
      path: s.path.map((n) => ({ ...n, state: "known" as const })),
      notes: t!.notes,
    });
  },

  async updateTicket(id, patch) {
    const who = staff();
    const t = tickets.find((x) => x.id === id) ?? fail("Ticket not found");
    if (patch.status) t!.status = patch.status;
    if (patch.priority) t!.priority = patch.priority;
    if (patch.assignToMe) t!.assignee = who.fullName;
    return wait(undefined);
  },

  async addNote(ticketId, body) {
    const who = staff();
    const cleanBody = body.trim();
    if (!cleanBody) fail("Write a note before adding it");
    if (cleanBody.length > 2000) fail("Internal notes are limited to 2,000 characters");
    const t = tickets.find((x) => x.id === ticketId) ?? fail("Ticket not found");
    t!.notes.push({ author: who.fullName, body: cleanBody, createdAt: new Date().toISOString() });
    return wait(undefined);
  },

  async getStats(): Promise<QueueStats> {
    staff();
    return wait({
      open: tickets.filter((t) => t.status !== "resolved").length,
      needsReview: tickets.filter((t) => t.status === "needs_review").length,
      resolvedToday: 22 + tickets.filter((t) => t.status === "resolved").length,
      avgResolutionMinutes: 18,
    });
  },

  async getRoutes() { staff(); return wait(routes); },

  async saveRoute(ticketId) {
    staff();
    const t = tickets.find((x) => x.id === ticketId) ?? fail("Ticket not found");
    const name = `${t!.categoryShort} → ${t!.diagnosisLabel ?? t!.subject}`;
    const found = routes.find((r) => r.name === name);
    if (found) { found.uses += 1; return wait(found); }
    const stepCount = sessions[t!.sessionId]!.attempts.length;
    const route: SavedRoute = { id: uid("r"), name, steps: stepCount, uses: 1 };
    routes = [route, ...routes];
    return wait(route);
  },

  /* ----------------------------- authoring ---------------------------- */

  async openDraft(categoryId) {
    admin();
    const existing = Object.values(trees).find((t) => t.categoryId === categoryId && t.status === "draft");
    if (existing) return wait(editableTree(existing.id));

    const source = publishedTree(categoryId) ?? fail("Nothing to clone");
    const draftId = uid("tree");
    const version = Math.max(...Object.values(trees).filter((t) => t.categoryId === categoryId).map((t) => t.version)) + 1;
    trees[draftId] = { id: draftId, categoryId, version, status: "draft", rootLabel: source!.rootLabel, rootNodeId: null };

    const map: Record<string, string> = {};
    Object.values(nodes).filter((n) => n.treeId === source!.id).forEach((n) => {
      const nid = uid("node");
      nodes[nid] = { ...n, id: nid, treeId: draftId, optionIds: [] };
      map[n.id] = nid;
    });
    Object.values(options).filter((o) => map[o.nodeId]).forEach((o) => {
      const oid = uid("opt");
      options[oid] = { ...o, id: oid, nodeId: map[o.nodeId]!, nextNodeId: o.nextNodeId ? map[o.nextNodeId]! : null };
      nodes[map[o.nodeId]!]!.optionIds.push(oid);
    });
    trees[draftId]!.rootNodeId = source!.rootNodeId ? map[source!.rootNodeId]! : null;

    return wait(editableTree(draftId));
  },

  async getDiagnosisOptions(): Promise<DiagnosisSummary[]> {
    admin();
    return wait(Object.values(diagnoses)
      .map(({ id, key, shortLabel, nodeLabel }) => ({ id, key, shortLabel, nodeLabel }))
      .sort((a, b) => a.shortLabel.localeCompare(b.shortLabel)));
  },

  async saveNode(treeId, node) {
    admin();
    draftTree(treeId);
    const question = node.question?.trim() ?? "";
    const factLabel = node.factLabel?.trim() ?? "";
    const shortLabel = node.shortLabel?.trim() ?? "";
    if (!question || !factLabel || !shortLabel) {
      fail("Question, fact label, and trail label are all required");
    }
    if (node.id) {
      const existingNode = nodeInDraft(treeId, node.id);
      Object.assign(existingNode, {
        question,
        factLabel,
        shortLabel,
      });
    } else {
      const id = uid("node");
      const position = Object.values(nodes).filter((n) => n.treeId === treeId).length;
      const key = shortLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24) + "_" + position;
      nodes[id] = {
        id, treeId, key, position, optionIds: [],
        question,
        factLabel,
        shortLabel,
      };
      if (!trees[treeId]!.rootNodeId) trees[treeId]!.rootNodeId = id;
    }
    return wait(editableTree(treeId));
  },

  async deleteNode(treeId, nodeId) {
    admin();
    const currentNode = nodeInDraft(treeId, nodeId);
    const pointedAt = Object.values(options).filter((o) => o.nextNodeId === nodeId);
    if (pointedAt.length) fail("Another answer still leads here. Repoint it first.");
    if (trees[treeId]!.rootNodeId === nodeId) trees[treeId]!.rootNodeId = null;
    currentNode.optionIds.forEach((o) => delete options[o]);
    delete nodes[nodeId];
    return wait(editableTree(treeId));
  },

  async saveOption(treeId, nodeId, option) {
    admin();
    const currentNode = nodeInDraft(treeId, nodeId);
    if (Boolean(option.nextNodeId) === Boolean(option.diagnosisId)) {
      fail("Every answer must lead to exactly one question or diagnosis");
    }
    const label = option.label?.trim() ?? "";
    const factValue = option.factValue?.trim() ?? "";
    if (!label || !factValue) fail("Answer text and recorded value are required");
    if (option.nextNodeId) nodeInDraft(treeId, option.nextNodeId);
    if (option.id) {
      const existingOption = options[option.id] ?? fail("Answer not found");
      if (existingOption.nodeId !== currentNode.id) fail("That answer does not belong to this question");
      Object.assign(existingOption, {
        label,
        factValue,
        nextNodeId: option.nextNodeId ?? null,
        diagnosisId: option.diagnosisId ?? null,
      });
    } else {
      const id = uid("opt");
      options[id] = {
        id, nodeId, label, factValue,
        position: currentNode.optionIds.length,
        nextNodeId: option.nextNodeId ?? null, diagnosisId: option.diagnosisId ?? null,
      };
      currentNode.optionIds.push(id);
    }
    return wait(editableTree(treeId));
  },

  async deleteOption(treeId, nodeId, optionId) {
    admin();
    draftTree(treeId);
    const o = options[optionId] ?? fail("Answer not found");
    if (o.nodeId !== nodeId) fail("That answer does not belong to this question");
    const parent = nodeInDraft(treeId, nodeId);
    parent.optionIds = parent.optionIds.filter((x) => x !== optionId);
    delete options[optionId];
    return wait(editableTree(treeId));
  },

  async setRootNode(treeId, nodeId) {
    admin();
    const tree = draftTree(treeId);
    nodeInDraft(treeId, nodeId);
    tree.rootNodeId = nodeId;
    return wait(editableTree(treeId));
  },

  async publishTree(treeId) {
    admin();
    const tree = trees[treeId] ?? fail("Tree not found");
    if (tree.status !== "draft") fail("Only a draft can be published");
    const rootNodeId = tree.rootNodeId;
    if (rootNodeId === null) throw new Error("Set a first question before publishing");

    const own = Object.values(nodes).filter((n) => n.treeId === treeId);
    const unanswered = own.filter((n) => n.optionIds.length === 0);
    if (unanswered.length) {
      fail(`These questions have no answers yet: ${unanswered.map((n) => n.shortLabel).join(", ")}`);
    }

    const reachable = new Set<string>([rootNodeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of own) {
        if (!reachable.has(n.id)) continue;
        for (const oid of n.optionIds) {
          const next = options[oid]!.nextNodeId;
          if (next && !reachable.has(next)) { reachable.add(next); grew = true; }
        }
      }
    }
    const orphans = own.filter((n) => !reachable.has(n.id));
    if (orphans.length) {
      fail(`These questions can never be reached: ${orphans.map((n) => n.shortLabel).join(", ")}`);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      const node = nodes[nodeId]!;
      for (const optionId of node.optionIds) {
        const next = options[optionId]!.nextNodeId;
        if (next && hasCycle(next)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };
    if (hasCycle(rootNodeId)) fail("This draft contains a loop. Diagnostic paths must always move forward.");

    Object.values(trees)
      .filter((t) => t.categoryId === tree.categoryId && t.status === "published")
      .forEach((t) => { t.status = "archived"; });
    tree.status = "published";

    return wait(editableTree(treeId));
  },
};
