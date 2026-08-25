import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.149.1\n");
  process.exit(0);
}

const input = createInterface({ input: process.stdin });
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let approvalSent = false;

const resultFor = (method) => {
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
  if (method === "thread/list") return { data: [], nextCursor: null };
  return {};
};

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized" && !approvalSent) {
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
  if (message.id !== undefined && message.method) write({ id: message.id, result: resultFor(message.method) });
});
