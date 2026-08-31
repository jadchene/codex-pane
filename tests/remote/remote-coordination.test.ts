import { describe, expect, it, vi } from "vitest";
import type { AppServerSupervisor } from "../../electron/main/app-server-supervisor";
import { ServerRequestCoordinator } from "../../electron/main/server-request-coordinator";
import { ThreadSubscriptionRegistry } from "../../electron/main/thread-subscription-registry";

const fakeSupervisor = () => ({ call: vi.fn().mockResolvedValue({}), respondToServer: vi.fn() }) as unknown as AppServerSupervisor;

describe("remote coordination", () => {
  it("keeps a thread subscribed until desktop and remote owners both release it", async () => {
    const supervisor = fakeSupervisor();
    const registry = new ThreadSubscriptionRegistry(supervisor);
    registry.acquire("thread-1", "desktop");
    registry.acquire("thread-1", "remote");
    expect(await registry.release("thread-1", "desktop")).toBe(false);
    expect(supervisor.call).not.toHaveBeenCalled();
    expect(await registry.release("thread-1", "remote")).toBe(true);
    expect(supervisor.call).toHaveBeenCalledWith("thread/unsubscribe", { threadId: "thread-1" });
  });

  it("allows one-time command and URL MCP decisions but rejects structured MCP forms", () => {
    const supervisor = fakeSupervisor();
    const coordinator = new ServerRequestCoordinator(supervisor);
    const command = coordinator.observe(3, 7, "item/commandExecution/requestApproval", { threadId: "thread-1", command: "npm test" });
    expect(command).not.toBeNull();
    coordinator.resolve("7", command!.version, "accept");
    expect(supervisor.respondToServer).toHaveBeenCalledWith(3, 7, { decision: "accept" });
    expect(() => coordinator.resolve("7", command!.version, "decline")).toThrow("已经过期");
    expect(coordinator.observe(3, 8, "mcpServer/elicitation/request", { threadId: "thread-1", mode: "form" })).toBeNull();
    const urlMcp = coordinator.observe(3, 9, "mcpServer/elicitation/request", { threadId: "thread-1", mode: "url" });
    coordinator.resolve("9", urlMcp!.version, "decline");
    expect(supervisor.respondToServer).toHaveBeenLastCalledWith(3, 9, { action: "decline", content: null, _meta: null });
  });
});
