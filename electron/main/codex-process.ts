import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

let testFixturePath: string | null = null;
let testCodexArgsPrefix: string[] = [];

export const useCodexFixtureForTests = (path: string): void => {
  testFixturePath = path;
};

export const useCodexArgsPrefixForTests = (args: string[]): void => {
  testCodexArgsPrefix = [...args];
};

export const spawnCodex = (args: readonly string[], options: SpawnOptions = {}): ChildProcess => {
  if (testFixturePath) {
    return spawn("node", [testFixturePath, ...args], { ...options, shell: false, windowsHide: true });
  }
  if (process.platform === "win32") {
    const commandProcessor = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    return spawn(commandProcessor, ["/d", "/s", "/c", "codex", ...testCodexArgsPrefix, ...args], {
      ...options,
      shell: false,
      windowsHide: true
    });
  }
  return spawn("codex", [...testCodexArgsPrefix, ...args], { ...options, shell: false });
};

export const forceTerminateProcessTree = (pid: number | undefined): Promise<void> => {
  if (!pid) return Promise.resolve();
  if (process.platform !== "win32") {
    try { process.kill(pid, "SIGKILL"); } catch { /* Process already exited. */ }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore", shell: false });
    killer.once("error", () => resolve());
    killer.once("exit", () => resolve());
  });
};
