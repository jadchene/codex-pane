import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnCodex, useCodexFixtureForTests } from "../../electron/main/codex-process";

describe("Codex process working directory", () => {
  it("starts app-server with the explicitly configured global default directory", async () => {
    const cwd = resolve("test-results", `app-server-cwd-${randomUUID()}`);
    await mkdir(cwd, { recursive: true });
    useCodexFixtureForTests(resolve("tests", "fixtures", "fake-codex", "fake-app-server.mjs"));
    const child = spawnCodex(["app-server"], { cwd, env: { ...process.env, CODEX_PANE_REPORT_FIXTURE_CWD: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    try {
      const response = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
        let output = "";
        child.once("error", reject);
        child.stdout?.on("data", (chunk: Buffer) => {
          output += chunk.toString("utf8");
          const lineEnd = output.indexOf("\n");
          if (lineEnd >= 0) resolveResponse(JSON.parse(output.slice(0, lineEnd)) as Record<string, unknown>);
        });
      });
      child.stdin?.write(`${JSON.stringify({ id: 1, method: "initialize", params: {} })}\n`);
      const message = await response;
      expect((message.result as Record<string, unknown>).fixtureCwd).toBe(cwd);
    } finally {
      const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      child.kill();
      await exited;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
