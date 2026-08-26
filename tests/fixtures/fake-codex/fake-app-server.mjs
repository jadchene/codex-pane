import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.149.1\n");
  process.exit(0);
}

const input = createInterface({ input: process.stdin });
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let approvalSent = false;

const resultFor = (method, params = {}) => {
  if (method === "initialize") return {
    userAgent: "codex-pane-fixture/0.149.1",
    codexHome: "fixture",
    platformFamily: "windows",
    platformOs: "windows",
    ...(process.env.CODEX_PANE_REPORT_FIXTURE_CWD === "1" ? { fixtureCwd: process.cwd() } : {})
  };
  if (method === "model/list") return { data: [], nextCursor: null };
  if (method === "account/read") return { account: { type: "apiKey" }, requiresOpenaiAuth: true };
  if (method === "account/rateLimits/read") return {};
  if (method === "config/read") return { config: { model: "fixture-model", model_provider: "fixture", sandbox_mode: "workspace-write", approval_policy: "on-request" }, origins: {}, layers: null };
  if (method === "permissionProfile/list") return { data: [], nextCursor: null };
  if (method === "thread/list") return {
    data: [
      { id: "fixture-thread-a", name: "示例会话 A", preview: "查看第一个会话", cwd: "E:\\AI-Workspace", updatedAt: 2, status: { type: "idle" } },
      { id: "fixture-thread-b", name: "示例会话 B", preview: "查看第二个会话", cwd: "E:\\AI-Workspace", updatedAt: 1, status: { type: "idle" } }
    ],
    nextCursor: null
  };
  if (method === "thread/resume") return {
    thread: { id: params.threadId, name: params.threadId === "fixture-thread-b" ? "示例会话 B" : "示例会话 A", turns: [] },
    initialTurnsPage: { data: [], nextCursor: null },
    cwd: "E:\\AI-Workspace",
    model: "fixture-model",
    reasoningEffort: "medium"
  };
  return {};
};

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized" && !approvalSent && existsSync(resolve(".approval-fixture"))) {
    approvalSent = true;
    setTimeout(() => write({
      id: "approval-fixture-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        itemId: "fixture-item",
        startedAtMs: Date.now(),
        environmentId: null,
        reason: "验证完整审批链路",
        command: "Get-ChildItem",
        cwd: "E:\\AI-Workspace",
        availableDecisions: ["accept", "decline"]
      }
    }), 500);
    return;
  }
  if (message.id === "approval-fixture-1" && message.method === undefined) {
    appendFileSync(resolve("test-results", "approval-response.jsonl"), `${JSON.stringify(message)}\n`, "utf8");
    write({ method: "serverRequest/resolved", params: { requestId: "approval-fixture-1" } });
    return;
  }
  if (message.id !== undefined && message.method) write({ id: message.id, result: resultFor(message.method, message.params) });
});
