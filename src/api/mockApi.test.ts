import { describe, expect, it } from "vitest";
import { mockApi } from "./mockApi";

async function signIn(email: string) {
  return mockApi.signIn(email, "");
}

describe.sequential("mock API contract", () => {
  it("keeps the technician queue closed to end users", async () => {
    await signIn("maya@northgate.test");
    await expect(mockApi.getTickets()).rejects.toThrow(/technician/i);
  });

  it("keeps ticket mutations behind the staff role", async () => {
    await signIn("maya@northgate.test");
    await expect(mockApi.updateTicket("not-a-ticket", { status: "resolved" })).rejects.toThrow(/technician/i);
    await expect(mockApi.addNote("not-a-ticket", "Internal note")).rejects.toThrow(/technician/i);
    await expect(mockApi.saveRoute("not-a-ticket")).rejects.toThrow(/technician/i);
  });

  it("rejects an answer that does not belong to the current question", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const wifi = catalog.categories.find((category) => category.slug === "wifi");
    expect(wifi).toBeDefined();

    const session = await mockApi.startSession({
      categoryId: wifi!.id,
      description: "Connected to Wi-Fi, but websites will not load.",
      device: "Laptop",
      operatingSystem: "macOS",
    });

    await expect(mockApi.answer(session.id, "not-a-real-option")).rejects.toThrow(
      /does not belong to the current question/i,
    );
  });

  it("walks a Wi-Fi diagnosis and restores the same state", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const wifi = catalog.categories.find((category) => category.slug === "wifi")!;

    let session = await mockApi.startSession({
      categoryId: wifi.id,
      description: "Connected to Wi-Fi, but every website fails.",
      device: "Laptop",
      operatingSystem: "macOS",
    });

    const choose = async (label: string) => {
      const option = session.node?.options.find((item) => item.label === label);
      expect(option, `expected option ${label}`).toBeDefined();
      session = await mockApi.answer(session.id, option!.id);
    };

    await choose("Yes");
    await choose("Yes");
    await choose("All of them");
    await choose("Nothing changed");

    expect(session.diagnosis?.key).toBe("dns");
    const restored = await mockApi.getSession(session.id);
    expect(restored.id).toBe(session.id);
    expect(restored.facts).toEqual(session.facts);
    expect(restored.diagnosis?.key).toBe("dns");
  });

  it("does not let one end user resume another user's session", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const other = catalog.categories.find((category) => category.slug === "other")!;
    const session = await mockApi.startSession({
      categoryId: other.id,
      description: "Something is not behaving normally.",
      device: "Laptop",
      operatingSystem: "macOS",
    });

    await signIn("jordan@northgate.test");
    await expect(mockApi.getSession(session.id)).rejects.toThrow(/not your session/i);
  });

  it("keeps draft branches inside the cloned tree", async () => {
    await signIn("sam@northgate.test");
    const catalog = await mockApi.getCatalog();
    const wifi = catalog.categories.find((category) => category.slug === "wifi")!;
    const draft = await mockApi.openDraft(wifi.id);
    const nodeIds = new Set(draft.nodes.map((node) => node.id));

    expect(draft.status).toBe("draft");
    expect(draft.rootNodeId && nodeIds.has(draft.rootNodeId)).toBe(true);

    for (const node of draft.nodes) {
      for (const option of node.options) {
        expect(Boolean(option.nextNodeId) !== Boolean(option.diagnosisId)).toBe(true);
        if (option.nextNodeId) expect(nodeIds.has(option.nextNodeId)).toBe(true);
      }
    }
  });

  it("keeps troubleshooting attempts ordered and immutable", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const wifi = catalog.categories.find((category) => category.slug === "wifi")!;

    let session = await mockApi.startSession({
      categoryId: wifi.id,
      description: "Every website fails even though Wi-Fi shows connected.",
      device: "Laptop",
      operatingSystem: "macOS",
    });

    for (const label of ["Yes", "Yes", "All of them", "Nothing changed"]) {
      const option = session.node?.options.find((item) => item.label === label);
      expect(option).toBeDefined();
      session = await mockApi.answer(session.id, option!.id);
    }

    const [first, second] = session.diagnosis!.steps;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await expect(mockApi.recordAttempt(session.id, second!.id, "failed")).rejects.toThrow(/in order/i);

    session = await mockApi.recordAttempt(session.id, first!.id, "failed");
    expect(session.attempts).toHaveLength(1);

    // Retrying the exact same mutation is safe.
    session = await mockApi.recordAttempt(session.id, first!.id, "failed");
    expect(session.attempts).toHaveLength(1);

    // But history cannot be rewritten after the fact.
    await expect(mockApi.recordAttempt(session.id, first!.id, "fixed")).rejects.toThrow(/already recorded/i);
    await expect(mockApi.undoLastAnswer(session.id)).rejects.toThrow(/after troubleshooting has started/i);
  });

  it("marks a discarded session abandoned and refuses later answers", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const other = catalog.categories.find((category) => category.slug === "other")!;
    const session = await mockApi.startSession({
      categoryId: other.id,
      description: "I want to start this report over.",
      device: "Laptop",
      operatingSystem: "macOS",
    });
    const firstOption = session.node!.options[0]!;

    await mockApi.abandonSession(session.id);
    const abandoned = await mockApi.getSession(session.id);
    expect(abandoned.status).toBe("abandoned");
    await expect(mockApi.answer(session.id, firstOption.id)).rejects.toThrow(/no longer active/i);
  });

  it("does not allow escalation before a diagnosis is reached", async () => {
    await signIn("maya@northgate.test");
    const catalog = await mockApi.getCatalog();
    const login = catalog.categories.find((category) => category.slug === "login")!;
    const session = await mockApi.startSession({
      categoryId: login.id,
      description: "I cannot sign in.",
      device: "Laptop",
      operatingSystem: "Windows",
    });

    await expect(mockApi.escalate(session.id, "Please help")).rejects.toThrow(
      /complete the diagnostic questions/i,
    );
  });

  it("rejects diagnostic loops before a draft can be published", async () => {
    await signIn("sam@northgate.test");
    const catalog = await mockApi.getCatalog();
    const login = catalog.categories.find((category) => category.slug === "login")!;
    let draft = await mockApi.openDraft(login.id);

    const root = draft.nodes.find((node) => node.id === draft.rootNodeId)!;
    const second = draft.nodes.find((node) => node.id !== root.id)!;
    const terminal = second.options.find((option) => option.diagnosisId)!;

    draft = await mockApi.saveOption(draft.id, second.id, {
      id: terminal.id,
      label: terminal.label,
      factValue: terminal.factValue,
      nextNodeId: root.id,
      diagnosisId: null,
    });

    await expect(mockApi.publishTree(draft.id)).rejects.toThrow(/loop/i);
  });
});

describe.sequential("final workflow guards", () => {
  it("makes resolution terminal and keeps assignment meaningful", async () => {
    await signIn("jordan@northgate.test");
    const ticket = (await mockApi.getTickets()).find((t) => !t.assignee && t.status !== "resolved")!;
    await mockApi.updateTicket(ticket.id, { status: "assigned", assignToMe: true });
    await mockApi.sendTicketMessage(ticket.id, "Please confirm the connection", true);
    await mockApi.updateTicket(ticket.id, { status: "resolved" });
    for (const status of ["new", "assigned", "waiting", "needs_review"] as const) {
      await expect(mockApi.updateTicket(ticket.id, { status })).rejects.toThrow(/status change/i);
    }
    await expect(mockApi.updateTicket(ticket.id, { assignToMe: true })).rejects.toThrow(/cannot be assigned/i);
  });
  it("rejects oversized descriptions rather than truncating them", async () => {
    await signIn("maya@northgate.test");
    const category = (await mockApi.getCatalog()).categories[0]!;
    await expect(mockApi.startSession({ categoryId: category.id, description: "x".repeat(4001), device: "Laptop", operatingSystem: "macOS" })).rejects.toThrow(/4,000/);
  });
});

describe.sequential("product completion", () => {
  it("separates public replies from notes, preserves assignment, and deduplicates reusable paths", async () => {
    await signIn("maya@northgate.test");
    const category = (await mockApi.getCatalog()).categories.find(c => c.slug === "other")!;
    let session = await mockApi.startSession({ categoryId: category.id, description: "Private requester detail", device: "Laptop", operatingSystem: "macOS" });
    while (session.node) session = await mockApi.answer(session.id, session.node.options[0]!.id);
    const ticket = await mockApi.escalate(session.id, "Private additional note");
    await signIn("jordan@northgate.test");
    await mockApi.updateTicket(ticket.id, { assignToMe: true, status: "assigned" });
    await expect(mockApi.updateTicket(ticket.id, { status: "waiting" })).rejects.toThrow(/conversation/);
    await mockApi.addNote(ticket.id, "Private technician note");
    await mockApi.sendTicketMessage(ticket.id, "Ordinary message");
    expect((await mockApi.getTicket(ticket.id)).status).toBe("assigned");
    await mockApi.sendTicketMessage(ticket.id, " Please check again ", true);
    const saved = await mockApi.saveRoute(ticket.id);
    expect((await mockApi.saveRoute(ticket.id)).id).toBe(saved.id);
    expect(saved.path.length).toBeGreaterThan(0);
    expect(JSON.stringify(saved)).not.toMatch(/Private requester|Private additional|Private technician/);
    await signIn("sam@northgate.test");
    await expect(mockApi.getMyTicket(ticket.id)).rejects.toThrow(/not found/i);
    await signIn("maya@northgate.test");
    const own = await mockApi.getMyTicket(ticket.id);
    expect(own.status).toBe("waiting");
    expect(own.messages[1]?.body).toBe("Please check again");
    expect(own).not.toHaveProperty("notes");
    expect(JSON.stringify(own)).not.toContain("Private technician");
    await expect(mockApi.sendTicketMessage(ticket.id, " \t\n ")).rejects.toThrow(/message/);
    await mockApi.sendTicketMessage(ticket.id, "Still broken");
    await signIn("jordan@northgate.test");
    const updated = await mockApi.getTicket(ticket.id);
    expect(updated.status).toBe("needs_review");
    expect(updated.assigneeId).toBe("u_jordan");
    await mockApi.sendTicketMessage(ticket.id, "Reviewing your reply");
    expect((await mockApi.getTicket(ticket.id)).status).toBe("needs_review");
    await mockApi.updateTicket(ticket.id, { status: "resolved" });
    await expect(mockApi.sendTicketMessage(ticket.id, "Reopen")).rejects.toThrow(/resolved/i);
  });
  it("uses the same validation for preview results and publication and records admin changes", async () => {
    await signIn("sam@northgate.test");
    const category = (await mockApi.getCatalog()).categories.find(c => c.slug === "other")!;
    let tree = await mockApi.openDraft(category.id);
    expect((await mockApi.validateTree(tree.id)).valid).toBe(true);
    tree = await mockApi.saveNode(tree.id, { question: "Unreachable", shortLabel: "Unreachable", factLabel: "Detail" });
    expect((await mockApi.validateTree(tree.id)).valid).toBe(false);
    await expect(mockApi.publishTree(tree.id)).rejects.toThrow();
    const node = tree.nodes.find(n => n.question === "Unreachable")!;
    await mockApi.deleteNode(tree.id, node.id);
    expect((await mockApi.validateTree(tree.id)).valid).toBe(true);
    await mockApi.publishTree(tree.id);
    const history = await mockApi.getTreeVersions(category.id);
    expect(history.some(v => v.status === "archived")).toBe(true);
    const events = await mockApi.getAdminAudit(category.id);
    expect(events.map(e => e.action)).toContain("tree_published");
    expect(events.every(e => e.actor === "Sam Adeyemi")).toBe(true);
  });
});
