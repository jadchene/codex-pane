import { describe, expect, it } from "vitest";
import { safeRequestSchema, serverResponseSchema } from "../../electron/shared/contracts";

describe("renderer IPC contracts", () => {
  it("strips renderer-provided sandbox and approval policy fields", () => {
    const request = safeRequestSchema.parse({
      method: "thread/start",
      params: { cwd: null, model: null, ephemeral: false, sandbox: "danger-full-access", approvalPolicy: "never" }
    });
    expect(request.params).toEqual({ cwd: null, model: null, ephemeral: false });
  });

  it("rejects methods outside the UI allowlist and ambiguous responses", () => {
    expect(() => safeRequestSchema.parse({ method: "config/write", params: {} })).toThrow();
    expect(() => serverResponseSchema.parse({ generation: 1, id: 1, result: {}, error: { code: -1, message: "x" } })).toThrow();
    expect(() => serverResponseSchema.parse({ generation: 1, id: 1 })).toThrow();
  });

  it("allows only the supported thread cwd update and optimistic message identity", () => {
    expect(safeRequestSchema.parse({ method: "thread/settings/update", params: { threadId: "thread-1", cwd: "E:\\Work" } })).toEqual({ method: "thread/settings/update", params: { threadId: "thread-1", cwd: "E:\\Work" } });
    const request = safeRequestSchema.parse({ method: "turn/steer", params: { threadId: "thread-1", expectedTurnId: "turn-1", clientUserMessageId: "client-1", input: [{ type: "text", text: "hello", text_elements: [] }] } });
    expect(request.params).toMatchObject({ clientUserMessageId: "client-1" });
    expect(safeRequestSchema.parse({ method: "thread/settings/update", params: { threadId: "thread-1", permissions: ":workspace" } })).toMatchObject({ params: { permissions: ":workspace" } });
    expect(safeRequestSchema.parse({ method: "turn/start", params: { threadId: "thread-1", clientUserMessageId: null, model: null, effort: null, input: [{ type: "skill", name: "project-verify", path: "E:\\Skills\\project-verify\\SKILL.md" }, { type: "mention", name: "README.md", path: "E:\\Work\\README.md" }] } })).toMatchObject({ method: "turn/start" });
  });

  it("allows scoped MCP auth, usage, agent discovery, and background-terminal controls", () => {
    expect(safeRequestSchema.parse({ method: "account/usage/read", params: { threadId: "thread-1" } })).toMatchObject({ method: "account/usage/read" });
    expect(safeRequestSchema.parse({ method: "mcpServer/oauth/login", params: { name: "docs", threadId: "thread-1", clientRegistration: "auto" } })).toMatchObject({ method: "mcpServer/oauth/login" });
    expect(safeRequestSchema.parse({ method: "thread/backgroundTerminals/list", params: { threadId: "thread-1", cursor: null, limit: 100 } })).toMatchObject({ method: "thread/backgroundTerminals/list" });
    expect(safeRequestSchema.parse({ method: "thread/backgroundTerminals/terminate", params: { threadId: "thread-1", processId: "42" } })).toMatchObject({ method: "thread/backgroundTerminals/terminate" });
    expect(safeRequestSchema.parse({ method: "thread/backgroundTerminals/clean", params: { threadId: "thread-1" } })).toMatchObject({ method: "thread/backgroundTerminals/clean" });
    expect(safeRequestSchema.parse({ method: "thread/list", params: { limit: 100, sortKey: "updated_at", sortDirection: "desc", searchTerm: null, ancestorThreadId: "thread-1", sourceKinds: ["subAgent", "subAgentReview"] } })).toMatchObject({ method: "thread/list" });
    expect(() => safeRequestSchema.parse({ method: "thread/list", params: { limit: 100, sortKey: "updated_at", sortDirection: "desc", searchTerm: null, ancestorThreadId: "thread-1", sourceKinds: ["cli"] } })).toThrow();
  });
});
