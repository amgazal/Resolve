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
