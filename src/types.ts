/**
 * The contract. Both api/client.ts (Supabase) and api/mockApi.ts
 * (in-memory) implement `Api`, so TypeScript refuses to let them drift
 * apart — if you change a payload shape, the mock stops compiling.
 */

export type Role = "end_user" | "technician" | "admin";
export type Priority = "low" | "medium" | "high";
export type TicketStatus = "new" | "assigned" | "waiting" | "needs_review" | "resolved";
export type AttemptOutcome = "fixed" | "failed" | "skipped";
export type TrailState = "known" | "current" | "unknown";

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
  shortLabel: string;
  hint: string | null;
  icon: string;
}

export interface Catalog {
  categories: Category[];
  devices: string[];
  systems: string[];
}

export interface AnswerOption {
  id: string;
  label: string;
}

export interface Question {
  id: string;
  key: string;
  question: string;
  factLabel: string;
  shortLabel: string;
  options: AnswerOption[];
}

export interface Step {
  id: string;
  position: number;
  title: string;
  detail: string;
}

export interface Diagnosis {
  id: string;
  key: string;
  title: string;
  shortLabel: string;
  nodeLabel: string;
  priority: Priority;
  steps: Step[];
}

export interface Fact {
  label: string;
  value: string;
}

export interface TrailNode {
  label: string;
  answer: string | null;
  state: TrailState;
  terminal?: boolean;
}

export interface Attempt {
  stepId: string;
  title: string;
  outcome: AttemptOutcome;
}

export interface SessionState {
  id: string;
  description: string;
  device: string | null;
  operatingSystem: string | null;
  categoryLabel: string;
  status: "in_progress" | "resolved" | "escalated" | "abandoned";
  facts: Fact[];
  path: TrailNode[];
  attempts: Attempt[];
  node: Question | null;
  diagnosis: Diagnosis | null;
}

export interface TicketRow {
  id: string;
  reference: string;
  requester: string;
  assignee: string | null;
  categoryLabel: string;
  categoryShort: string;
  diagnosisLabel: string | null;
  subject: string;
  priority: Priority;
  status: TicketStatus;
  createdAt: string;
}

export interface TicketNote {
  author: string;
  body: string;
  createdAt: string;
}

export interface TicketDetail extends TicketRow {
  description: string;
  device: string | null;
  operatingSystem: string | null;
  userNote: string | null;
  facts: Fact[];
  attempts: Attempt[];
  path: TrailNode[];
  notes: TicketNote[];
}

export interface QueueStats {
  open: number;
  needsReview: number;
  resolvedToday: number;
  avgResolutionMinutes: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  steps: number;
  uses: number;
}

/* ------------------------------- authoring ------------------------------ */

export interface EditableOption {
  id: string;
  label: string;
  factValue: string;
  position: number;
  nextNodeId: string | null;
  diagnosisId: string | null;
}

export interface EditableNode {
  id: string;
  key: string;
  question: string;
  factLabel: string;
  shortLabel: string;
  position: number;
  options: EditableOption[];
}

export interface EditableTree {
  id: string;
  categoryId: string;
  version: number;
  status: "draft" | "published" | "archived";
  rootLabel: string;
  rootNodeId: string | null;
  nodes: EditableNode[];
}

export interface DiagnosisSummary {
  id: string;
  key: string;
  shortLabel: string;
  nodeLabel: string;
}

/* ---------------------------------- api --------------------------------- */

export interface Api {
  /** Whoever is signed in, or null. Role comes from the database. */
  getProfile(): Promise<Profile | null>;
  signIn(email: string, password: string): Promise<Profile>;
  signOut(): Promise<void>;

  getCatalog(): Promise<Catalog>;

  startSession(input: {
    categoryId: string;
    description: string;
    device: string;
    operatingSystem: string;
  }): Promise<SessionState>;
  getSession(sessionId: string): Promise<SessionState>;
  abandonSession(sessionId: string): Promise<void>;
  answer(sessionId: string, optionId: string): Promise<SessionState>;
  undoLastAnswer(sessionId: string): Promise<SessionState>;
  recordAttempt(sessionId: string, stepId: string, outcome: AttemptOutcome): Promise<SessionState>;
  escalate(sessionId: string, note: string): Promise<{ id: string; reference: string }>;

  getTickets(): Promise<TicketRow[]>;
  getTicket(id: string): Promise<TicketDetail>;
  updateTicket(
    id: string,
    patch: { status?: TicketStatus; priority?: Priority; assignToMe?: boolean }
  ): Promise<void>;
  addNote(ticketId: string, body: string): Promise<void>;
  getStats(): Promise<QueueStats>;
  getRoutes(): Promise<SavedRoute[]>;
  saveRoute(ticketId: string): Promise<SavedRoute>;

  /** Admin only — the tree editor. */
  openDraft(categoryId: string): Promise<EditableTree>;
  getDiagnosisOptions(): Promise<DiagnosisSummary[]>;
  saveNode(treeId: string, node: Partial<EditableNode> & { id?: string }): Promise<EditableTree>;
  deleteNode(treeId: string, nodeId: string): Promise<EditableTree>;
  saveOption(
    treeId: string,
    nodeId: string,
    option: Partial<EditableOption> & { id?: string }
  ): Promise<EditableTree>;
  deleteOption(treeId: string, nodeId: string, optionId: string): Promise<EditableTree>;
  setRootNode(treeId: string, nodeId: string): Promise<EditableTree>;
  publishTree(treeId: string): Promise<EditableTree>;
}
