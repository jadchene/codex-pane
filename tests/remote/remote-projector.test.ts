import { describe, expect, it } from "vitest";
import { projectItem, RemoteProjector, sanitizeRemoteActivityText } from "../../electron/main/remote-projector";

describe("RemoteProjector", () => {
  it("projects only safe mobile fields and redacts secrets", () => {
    const item = projectItem({ id: "command-1", type: "commandExecution", command: "curl https://example.com?a=secret", aggregatedOutput: "Authorization: Bearer top-secret-value", status: "completed" });
    expect(item).toMatchObject({ kind: "activity", title: "命令执行" });
    expect(JSON.stringify(item)).not.toContain("top-secret-value");
    expect(JSON.stringify(item)).not.toContain("a=secret");
  });

  it("merges streaming agent deltas without exposing raw envelopes", () => {
    const projector = new RemoteProjector();
    projector.setActiveThread({ id: "thread-1", name: "会话", turns: [] });
    projector.applyProtocolEvent({ generation: 1, kind: "notification", payload: { method: "item/agentMessage/delta", params: { threadId: "thread-1", itemId: "agent-1", delta: "你好" } } });
    projector.applyProtocolEvent({ generation: 1, kind: "notification", payload: { method: "item/agentMessage/delta", params: { threadId: "thread-1", itemId: "agent-1", delta: "，世界" } } });
    expect(projector.snapshot().items).toEqual([{ id: "agent-1", kind: "agent", markdown: "你好，世界", status: "running" }]);
  });

  it("shows workspace-relative paths and hides paths outside the workspace", () => {
    expect(sanitizeRemoteActivityText('Get-Content "E:\\Work\\project\\src\\app.ts"', "E:\\Work\\project")).toContain('"src\\app.ts"');
    expect(sanitizeRemoteActivityText("Get-Content E:\\Secrets\\token.txt", "E:\\Work\\project")).toBe("Get-Content token.txt");
  });

  it("does not guess an unknown generic message role or expose MCP paths", () => {
    expect(projectItem({ id: "unknown-1", type: "message", text: "possibly internal" })).toEqual({ id: "unknown-1", kind: "activity", title: "任务活动", summary: "详细内容请在桌面端查看", status: "completed" });
    const item = projectItem({ id: "mcp-1", type: "mcpToolCall", name: "read E:\\Private\\token.txt" }, "E:\\Work\\project");
    expect(JSON.stringify(item)).not.toContain("E:\\Private");
  });

  it("hydrates an in-progress turn so a mobile follow-up uses steer semantics", () => {
    const projector = new RemoteProjector();
    projector.setActiveThread({ id: "thread-1", turns: [{ id: "turn-finished", status: "completed", items: [] }, { id: "turn-running", status: "inProgress", items: [] }] });
    expect(projector.activeTurnId).toBe("turn-running");
    expect(projector.snapshot().turnStatus).toBe("running");
  });
});
