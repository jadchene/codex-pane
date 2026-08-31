import type { AppServerSupervisor } from "./app-server-supervisor.js";

type PendingApproval = {
  generation: number;
  id: string | number;
  method: string;
  threadId: string;
  version: number;
};

const REMOTE_APPROVAL_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "execCommandApproval",
  "mcpServer/elicitation/request"
]);

export class ServerRequestCoordinator {
  readonly #supervisor: AppServerSupervisor;
  readonly #pending = new Map<string, PendingApproval>();
  #version = 0;

  constructor(supervisor: AppServerSupervisor) {
    this.#supervisor = supervisor;
  }

  observe(generation: number, id: string | number, method: string, params: Record<string, unknown>): PendingApproval | null {
    if (!REMOTE_APPROVAL_METHODS.has(method) || method === "mcpServer/elicitation/request" && params.mode !== "url") return null;
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const approval = { generation, id, method, threadId, version: ++this.#version };
    this.#pending.set(String(id), approval);
    return approval;
  }

  resolve(approvalId: string, version: number, decision: "accept" | "decline"): void {
    const approval = this.#pending.get(approvalId);
    if (!approval || approval.version !== version) throw new Error("该确认已处理或已经过期。");
    const result = approval.method === "mcpServer/elicitation/request"
      ? { action: decision, content: null, _meta: null }
      : approval.method === "execCommandApproval"
      ? { decision: decision === "accept" ? "approved" : { denied: { rejection: "用户从手机端拒绝了此操作" } } }
      : { decision };
    this.#supervisor.respondToServer(approval.generation, approval.id, result);
    this.#pending.delete(approvalId);
  }

  remove(id: string | number): void {
    this.#pending.delete(String(id));
  }

  clear(): void {
    this.#pending.clear();
  }
}
