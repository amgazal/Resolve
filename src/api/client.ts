/**
 * Supabase adapter.
 *
 * Two things worth noticing:
 *
 * 1. No role is ever sent from here. The prototype's `x-user-role` header
 *    is gone. Supabase attaches the signed JWT; Postgres resolves the role
 *    from public.users via auth.uid(). Editing anything client-side gets
 *    you your own rows and nothing else.
 *
 * 2. Traversal goes through RPCs, not table writes. The browser cannot
 *    update its own session row — RLS forbids it — so a diagnostic history
 *    is something the database observed, not something a client asserted.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Api, Catalog, DiagnosisSummary, EditableTree, Profile, QueueStats,
  SavedRoute, SessionState, TicketDetail, TicketRow,
} from "@/types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined;

export const isConfigured = Boolean(url && publishableKey);

const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, publishableKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const db = () => supabase ?? (() => { throw new Error("Supabase is not configured"); })();

/** Postgres speaks in error codes; people need sentences. */
function readable(error: { message: string; code?: string } | null): never {
  if (!error) throw new Error("Something went wrong");
  const map: Record<string, string> = {
    "42501": "You don't have access to that",
    "23505": "That already exists",
    PGRST301: "Your session expired. Sign in again.",
  };
  throw new Error(map[error.code ?? ""] ?? error.message);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) readable(error);
  return data as T;
}

export const supabaseApi: Api = {
  /* -------------------------------- auth -------------------------------- */

  async getProfile(): Promise<Profile | null> {
    const { data: auth } = await db().auth.getUser();
    if (!auth.user) return null;
    const { data, error } = await db()
      .from("users")
      .select("id, full_name, email, role")
      .eq("id", auth.user.id)
      .single();
    if (error) readable(error);
    return { id: data.id, fullName: data.full_name, email: data.email, role: data.role };
  },

  async signIn(email, password) {
    const { error } = await db().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const profile = await supabaseApi.getProfile();
    if (!profile) {
      await db().auth.signOut();
      throw new Error("Signed in, but no Resolve profile is linked to this account");
    }
    return profile;
  },

  async signOut() {
    const { error } = await db().auth.signOut();
    if (error) throw new Error(error.message);
  },

  /* ------------------------------ catalog ------------------------------- */

  async getCatalog(): Promise<Catalog> {
    // RLS already limits this to the caller's organization.
    const { data, error } = await db()
      .from("diagnostic_categories")
      .select("id, slug, label, short_label, hint, icon, diagnostic_trees!inner(status)")
      .eq("is_active", true)
      .eq("diagnostic_trees.status", "published")
      .order("position");
    if (error) readable(error);

    return {
      categories: data.map((c) => ({
        id: c.id, slug: c.slug, label: c.label,
        shortLabel: c.short_label, hint: c.hint, icon: c.icon,
      })),
      devices: ["Laptop", "Desktop", "Phone", "Tablet", "Printer", "Other"],
      systems: ["macOS", "Windows", "iOS", "Android", "Linux", "Not sure"],
    };
  },

  /* ------------------------------ diagnosis ----------------------------- */

  startSession: ({ categoryId, description, device, operatingSystem }) =>
    rpc<SessionState>("start_session", {
      p_category_id: categoryId,
      p_description: description,
      p_device: device,
      p_operating_system: operatingSystem,
    }),

  getSession: (sessionId) =>
    rpc<SessionState>("get_session_state", { p_session_id: sessionId }),

  async abandonSession(sessionId) {
    await rpc("abandon_session", { p_session_id: sessionId });
  },

  answer: (sessionId, optionId) =>
    rpc<SessionState>("answer_question", { p_session_id: sessionId, p_option_id: optionId }),

  undoLastAnswer: (sessionId) =>
    rpc<SessionState>("undo_last_answer", { p_session_id: sessionId }),

  recordAttempt: (sessionId, stepId, outcome) =>
    rpc<SessionState>("record_attempt", {
      p_session_id: sessionId, p_step_id: stepId, p_outcome: outcome,
    }),

  escalate: (sessionId, note) =>
    rpc<{ id: string; reference: string }>("escalate_session", {
      p_session_id: sessionId, p_note: note,
    }),

  /* ------------------------------- tickets ------------------------------ */

  async getTickets(): Promise<TicketRow[]> {
    const { data, error } = await db()
      .from("ticket_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) readable(error);
    return data.map((t) => ({
      id: t.id, reference: t.reference, requester: t.requester_name, assignee: t.assignee_name,
      categoryLabel: t.category_label, categoryShort: t.category_short,
      diagnosisLabel: t.diagnosis_label, subject: t.subject,
      priority: t.priority, status: t.status, createdAt: t.created_at,
    }));
  },

  async getTicket(id): Promise<TicketDetail> {
    const { data: t, error } = await db().from("ticket_queue").select("*").eq("id", id).single();
    if (error) readable(error);

    const [facts, attempts, notes, session] = await Promise.all([
      db().from("session_facts").select("label, value").eq("session_id", t.session_id).order("position"),
      db().from("step_attempts")
        .select("outcome, step_id, troubleshooting_steps(title, position)")
        .eq("session_id", t.session_id),
      db().from("ticket_notes")
        .select("body, created_at, users(full_name)")
        .eq("ticket_id", id).order("created_at"),
      rpc<SessionState>("get_session_state", { p_session_id: t.session_id }),
    ]);

    if (facts.error) readable(facts.error);
    if (attempts.error) readable(attempts.error);
    if (notes.error) readable(notes.error);

    return {
      id: t.id, reference: t.reference, requester: t.requester_name, assignee: t.assignee_name,
      categoryLabel: t.category_label, categoryShort: t.category_short,
      diagnosisLabel: t.diagnosis_label, subject: t.subject, priority: t.priority,
      status: t.status, createdAt: t.created_at,
      description: t.description, device: t.device, operatingSystem: t.operating_system,
      userNote: t.user_note,
      facts: facts.data ?? [],
      attempts: (attempts.data ?? [])
        .map((a: any) => ({
          stepId: a.step_id,
          title: a.troubleshooting_steps?.title ?? "",
          outcome: a.outcome,
          position: a.troubleshooting_steps?.position ?? 0,
        }))
        .sort((a: any, b: any) => a.position - b.position)
        .map(({ stepId, title, outcome }: any) => ({ stepId, title, outcome })),
      path: session.path.map((n) => ({ ...n, state: "known" as const })),
      notes: (notes.data ?? []).map((n: any) => ({
        author: n.users?.full_name ?? "System",
        body: n.body,
        createdAt: n.created_at,
      })),
    };
  },

  async updateTicket(id, patch) {
    await rpc("update_ticket", {
      p_ticket_id: id,
      p_status: patch.status ?? null,
      p_priority: patch.priority ?? null,
      p_assign_to_me: patch.assignToMe ?? false,
    });
  },

  async addNote(ticketId, body) {
    const cleanBody = body.trim();
    if (!cleanBody) throw new Error("Write a note before adding it");
    if (cleanBody.length > 2000) throw new Error("Internal notes are limited to 2,000 characters");
    await rpc("add_ticket_note", { p_ticket_id: ticketId, p_body: cleanBody });
  },

  getStats: () => rpc<QueueStats>("queue_stats"),

  async getRoutes(): Promise<SavedRoute[]> {
    const { data, error } = await db()
      .from("saved_routes")
      .select("id, name, step_titles, use_count")
      .order("use_count", { ascending: false })
      .limit(50);
    if (error) readable(error);
    return data.map((r) => ({
      id: r.id, name: r.name, steps: r.step_titles?.length ?? 0, uses: r.use_count,
    }));
  },

  saveRoute: (ticketId) => rpc<SavedRoute>("save_route", { p_ticket_id: ticketId }),

  /* ------------------------------ authoring ----------------------------- */

  async openDraft(categoryId): Promise<EditableTree> {
    const treeId = await rpc<string>("open_tree_draft", { p_category_id: categoryId });
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async getDiagnosisOptions(): Promise<DiagnosisSummary[]> {
    const { data, error } = await db()
      .from("diagnoses")
      .select("id, key, short_label, node_label")
      .eq("is_active", true)
      .order("short_label");
    if (error) readable(error);
    return data.map((d) => ({
      id: d.id, key: d.key, shortLabel: d.short_label, nodeLabel: d.node_label,
    }));
  },

  async saveNode(treeId, node) {
    const question = node.question?.trim();
    const factLabel = node.factLabel?.trim();
    const shortLabel = node.shortLabel?.trim();
    if (!question || !factLabel || !shortLabel) {
      throw new Error("Question, fact label, and trail label are all required");
    }

    const row = { question, fact_label: factLabel, short_label: shortLabel };
    if (node.id) {
      const { data, error } = await db()
        .from("diagnostic_nodes")
        .update(row)
        .eq("id", node.id)
        .eq("tree_id", treeId)
        .select("id")
        .maybeSingle();
      if (error) readable(error);
      if (!data) throw new Error("That question could not be updated. Refresh the draft and try again.");
    } else {
      const key = `${shortLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24)}_${Date.now().toString(36)}`;
      const { error } = await db().from("diagnostic_nodes").insert({ ...row, tree_id: treeId, key });
      if (error) readable(error);
    }
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async deleteNode(treeId, nodeId) {
    const { data, error } = await db()
      .from("diagnostic_nodes")
      .delete()
      .eq("id", nodeId)
      .eq("tree_id", treeId)
      .select("id")
      .maybeSingle();
    // A foreign key violation here means another answer still points at it.
    if (error) {
      if (error.code === "23503") throw new Error("Another answer still leads here. Repoint it first.");
      readable(error);
    }
    if (!data) throw new Error("That question could not be removed. Refresh the draft and try again.");
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async saveOption(treeId, nodeId, option) {
    if (Boolean(option.nextNodeId) === Boolean(option.diagnosisId)) {
      throw new Error("Every answer must lead to exactly one question or diagnosis");
    }
    const label = option.label?.trim();
    const factValue = option.factValue?.trim();
    if (!label || !factValue) throw new Error("Answer text and recorded value are required");

    const row = {
      label, fact_value: factValue,
      next_node_id: option.nextNodeId ?? null, diagnosis_id: option.diagnosisId ?? null,
    };
    if (option.id) {
      const { data, error } = await db().from("diagnostic_options")
        .update(row)
        .eq("id", option.id)
        .eq("node_id", nodeId)
        .select("id")
        .maybeSingle();
      if (error) readable(error);
      if (!data) throw new Error("That answer could not be updated. Refresh the draft and try again.");
    } else {
      const { error } = await db()
        .from("diagnostic_options")
        .insert({ ...row, node_id: nodeId, position: option.position ?? 0 });
      if (error) readable(error);
    }
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async deleteOption(treeId, nodeId, optionId) {
    const { data, error } = await db()
      .from("diagnostic_options")
      .delete()
      .eq("id", optionId)
      .eq("node_id", nodeId)
      .select("id")
      .maybeSingle();
    if (error) readable(error);
    if (!data) throw new Error("That answer could not be removed. Refresh the draft and try again.");
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async setRootNode(treeId, nodeId) {
    const { data, error } = await db()
      .from("diagnostic_trees")
      .update({ root_node_id: nodeId })
      .eq("id", treeId)
      .select("id")
      .maybeSingle();
    if (error) readable(error);
    if (!data) throw new Error("The first question could not be changed. Refresh the draft and try again.");
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },

  async publishTree(treeId) {
    await rpc("publish_tree", { p_tree_id: treeId });
    return rpc<EditableTree>("get_tree", { p_tree_id: treeId });
  },
};
