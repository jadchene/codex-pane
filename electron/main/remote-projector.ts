import type { MobileItem, MobileSnapshot, ThreadSummary } from "../../packages/remote-protocol/src/index.js";
import type { ConnectionState, ProtocolEvent } from "../shared/contracts.js";
import { redactSensitiveText } from "./sensitive-data.js";
import { win32 } from "node:path";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const TRUNCATION_SUFFIX = "\n…内容已截断";
const truncate = (value: string, limit: number): string => {
  if (value.length <= limit) return value;
  if (limit <= TRUNCATION_SUFFIX.length) return value.slice(0, limit);
  return `${value.slice(0, limit - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
};
const safeText = (value: unknown, limit = 20_000): string => truncate(redactSensitiveText(text(value), true), limit);
const safePath = (path: string, cwd: string): string => {
  if (cwd) {
    const relativePath = win32.relative(cwd, path);
    if (relativePath && !relativePath.startsWith("..") && !win32.isAbsolute(relativePath)) return relativePath;
  }
  return win32.basename(path) || "工作区外路径";
};
export const sanitizeRemoteActivityText = (value: string, cwd = "", limit = 4_000): string => {
  const redacted = redactSensitiveText(value, true)
    .replace(/(["'])([A-Za-z]:[\\/][^"'\r\n]+)\1/g, (_match, quote: string, path: string) => `${quote}${safePath(path, cwd)}${quote}`)
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]+/g, (path) => safePath(path, cwd));
  return truncate(redacted, limit);
};
const itemStatus = (value: unknown): "running" | "completed" | "failed" => {
  const status = text(value).toLocaleLowerCase();
  if (status.includes("fail") || status.includes("error") || status.includes("declin")) return "failed";
  if (status.includes("progress") || status.includes("running") || status.includes("start")) return "running";
  return "completed";
};
const MAX_MOBILE_ITEMS = 300;

const inputText = (item: Record<string, unknown>): string => {
  if (typeof item.text === "string") return safeText(item.text);
  const content = Array.isArray(item.content) ? item.content : Array.isArray(item.input) ? item.input : [];
  return content.map((part) => {
    const value = record(part);
    return text(value.text) || (text(value.type).toLocaleLowerCase().includes("image") ? "[含附件]" : "");
  }).filter(Boolean).join("\n");
};

export const projectItem = (raw: unknown, cwd = ""): MobileItem | null => {
  const item = record(raw);
  const id = text(item.id) || text(item.itemId);
  if (!id) return null;
  const type = text(item.type);
  const status = itemStatus(item.status);
  if (type === "userMessage" || type === "user_message") {
    return { id, kind: "user", text: inputText(item), status };
  }
  if (type === "agentMessage" || type === "agent_message") {
    return { id, kind: "agent", markdown: safeText(item.text || item.content, 200_000), status };
  }
  if (type === "reasoning") return { id, kind: "activity", title: "思考过程", summary: "Agent 正在分析任务", status };
  if (type === "commandExecution" || type === "command_execution") {
    const command = Array.isArray(item.command) ? item.command.join(" ") : text(item.command);
    return { id, kind: "activity", title: "命令执行", summary: sanitizeRemoteActivityText(command || "执行了一条命令", cwd, 1_000), detail: sanitizeRemoteActivityText(text(item.aggregatedOutput || item.output), cwd, 4_000) || undefined, status };
  }
  if (type === "fileChange" || type === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return { id, kind: "activity", title: "文件变化", summary: changes.length ? `修改了 ${changes.length} 个文件，请在桌面端查看详情` : "文件已发生变化，请在桌面端查看详情", status };
  }
  if (type.includes("mcp") || type.includes("webSearch") || type.includes("plan") || type.includes("collab")) {
    return { id, kind: "activity", title: type.includes("mcp") ? "MCP 操作" : "任务活动", summary: sanitizeRemoteActivityText(text(item.name || item.query || item.server) || "已执行一项操作", cwd, 1_000), status };
  }
  return { id, kind: "activity", title: "任务活动", summary: "详细内容请在桌面端查看", status };
};

const projectTurnItems = (thread: Record<string, unknown>): MobileItem[] => {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  return turns.flatMap((rawTurn) => {
    const turn = record(rawTurn);
    return (Array.isArray(turn.items) ? turn.items : []).flatMap((rawItem) => {
      const item = projectItem(rawItem, text(thread.cwd));
      return item ? [item] : [];
    });
  });
};

export class RemoteProjector {
  #connection: ConnectionState = { phase: "stopped", generation: 0, codexVersion: null, compatible: null, message: "Codex 服务未启动" };
  #threads: ThreadSummary[] = [];
  #items: MobileItem[] = [];
  #activeThreadId: string | null = null;
  #activeThreadTitle = "未选择会话";
  #activeCwd = "";
  #appearance: MobileSnapshot["appearance"] = { theme: "system", accentColor: "#10a37f" };
  #turnStatus: MobileSnapshot["turnStatus"] = "idle";
  #activeTurnId: string | null = null;

  get activeThreadId(): string | null { return this.#activeThreadId; }
  get activeTurnId(): string | null { return this.#activeTurnId; }

  setConnection(state: ConnectionState): void {
    this.#connection = state;
  }

  setAppearance(appearance: MobileSnapshot["appearance"]): void {
    this.#appearance = appearance;
  }

  setThreads(rawThreads: unknown[]): ThreadSummary[] {
    this.#threads = rawThreads.flatMap((rawThread) => {
      const thread = record(rawThread);
      const id = text(thread.id);
      if (!id) return [];
      const rawStatus = text(record(thread.status).type) || text(thread.status);
      return [{
        id,
        title: safeText(thread.name || thread.preview || "未命名会话", 200),
        preview: safeText(thread.preview || "无预览内容", 1_000),
        updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : Date.now() / 1_000,
        status: rawStatus.includes("active") ? "running" as const : "idle" as const,
        unread: false
      }];
    }).slice(0, 100);
    return this.#threads;
  }

  setActiveThread(rawThread: unknown): void {
    const thread = record(rawThread);
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const activeTurn = [...turns].reverse().map(record).find((turn) => text(turn.status) === "inProgress");
    this.#activeThreadId = text(thread.id) || this.#activeThreadId;
    this.#activeThreadTitle = safeText(thread.name || "未命名会话", 200);
    this.#activeCwd = text(thread.cwd);
    this.#items = projectTurnItems(thread).slice(-MAX_MOBILE_ITEMS);
    this.#activeTurnId = activeTurn ? text(activeTurn.id) || null : null;
    this.#turnStatus = this.#activeTurnId ? "running" : "idle";
  }

  setActiveTurn(turnId: string): void {
    if (!turnId) return;
    this.#activeTurnId = turnId;
    this.#turnStatus = "running";
  }

  clearActiveThread(): void {
    this.#activeThreadId = null;
    this.#activeThreadTitle = "未选择会话";
    this.#activeCwd = "";
    this.#items = [];
    this.#turnStatus = "idle";
    this.#activeTurnId = null;
  }

  applyProtocolEvent(event: ProtocolEvent): { threadId: string; item: MobileItem } | null {
    if (event.kind !== "notification") return null;
    const envelope = record(event.payload);
    const method = text(envelope.method);
    const params = record(envelope.params);
    const threadId = text(params.threadId);
    if (threadId !== this.#activeThreadId) return null;
    if (method === "turn/started") {
      this.#turnStatus = "running";
      this.#activeTurnId = text(record(params.turn).id) || null;
    }
    if (method === "turn/completed") {
      this.#turnStatus = text(record(params.turn).status).includes("fail") ? "failed" : "idle";
      this.#activeTurnId = null;
    }
    if (method === "item/started" || method === "item/completed") {
      const item = projectItem(params.item, this.#activeCwd);
      if (!item) return null;
      const index = this.#items.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) this.#items[index] = item;
      else this.#items.push(item);
      if (this.#items.length > MAX_MOBILE_ITEMS) this.#items.splice(0, this.#items.length - MAX_MOBILE_ITEMS);
      return { threadId, item };
    }
    if (method === "item/agentMessage/delta") {
      const itemId = text(params.itemId);
      const delta = safeText(params.delta, 50_000);
      if (!itemId || !delta) return null;
      const existing = this.#items.find((candidate) => candidate.id === itemId && candidate.kind === "agent");
      const item: MobileItem = existing && existing.kind === "agent"
        ? { ...existing, markdown: truncate(existing.markdown + delta, 200_000), status: "running" }
        : { id: itemId, kind: "agent", markdown: delta, status: "running" };
      const index = this.#items.findIndex((candidate) => candidate.id === itemId);
      if (index >= 0) this.#items[index] = item;
      else this.#items.push(item);
      if (this.#items.length > MAX_MOBILE_ITEMS) this.#items.splice(0, this.#items.length - MAX_MOBILE_ITEMS);
      return { threadId, item };
    }
    return null;
  }

  snapshot(): MobileSnapshot {
    const phase = this.#connection.phase === "ready" ? "ready" : this.#connection.phase === "starting" || this.#connection.phase === "restarting" ? "starting" : this.#connection.phase === "error" ? "error" : "stopped";
    return {
      deviceOnline: true,
      codexState: phase,
      codexMessage: safeText(this.#connection.message, 1_000),
      appearance: this.#appearance,
      activeThreadId: this.#activeThreadId,
      activeThreadTitle: this.#activeThreadTitle,
      turnStatus: this.#turnStatus,
      threads: this.#threads,
      items: this.#items
    };
  }
}
