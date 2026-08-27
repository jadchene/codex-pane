import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

type ProcessEntry = { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null };
const runLiveChecks = existsSync(resolve(".packaged-live"));

const processTable = (): ProcessEntry[] => {
  const output = execFileSync("pwsh", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"], { encoding: "utf8" });
  const parsed = JSON.parse(output) as ProcessEntry | ProcessEntry[];
  return Array.isArray(parsed) ? parsed : [parsed];
};

const codexDescendants = (rootPid: number): ProcessEntry[] => {
  const table = processTable();
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of table) {
      if (descendants.has(process.ParentProcessId) && !descendants.has(process.ProcessId)) {
        descendants.add(process.ProcessId);
        changed = true;
      }
    }
  }
  return table.filter((process) => descendants.has(process.ProcessId) && /^(codex(?:\.exe)?|cmd\.exe)$/i.test(process.Name) && /app-server/i.test(process.CommandLine ?? ""));
};

const waitForGone = async (pids: number[]): Promise<void> => {
  await expect.poll(() => {
    const alive = new Set(processTable().map((process) => process.ProcessId));
    return pids.filter((pid) => alive.has(pid));
  }, { timeout: 7_000, intervals: [100, 250, 500] }).toEqual([]);
};

const launch = (executablePath: string, userDataPath: string): Promise<ElectronApplication> => electron.launch({
  executablePath,
  args: ["--disable-gpu", "--disable-software-rasterizer"],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !["CODEX_PANE_E2E_EXE", "CODEX_PANE_PACKAGED_LIVE", "CODEX_PANE_PACKAGED_CONCURRENCY"].includes(entry[0]) && typeof entry[1] === "string")),
    CODEX_PANE_USER_DATA_DIR: userDataPath
  }
});

const launchWithDefaultDataPath = (executablePath: string, appDataPath: string): Promise<ElectronApplication> => electron.launch({
  executablePath,
  args: ["--disable-gpu", "--disable-software-rasterizer"],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !["APPDATA", "CODEX_PANE_USER_DATA_DIR", "PORTABLE_EXECUTABLE_DIR", "PORTABLE_EXECUTABLE_FILE"].includes(entry[0]) && typeof entry[1] === "string")),
    APPDATA: appDataPath
  }
});

const waitForWorkbench = async (window: Page): Promise<void> => {
  await expect(window.getByRole("button", { name: "设置" })).toBeVisible({ timeout: 20_000 });
  await expect(window.locator(".pane").first()).toBeVisible();
};

const verifyWindowChrome = async (window: Page): Promise<void> => {
  const metrics = await window.evaluate(() => {
    const shellScroller = document.querySelector<HTMLElement>(".app-shell > .n-layout-scroll-container");
    const titlebar = document.querySelector<HTMLElement>(".custom-titlebar")!;
    const closeButton = document.querySelector<HTMLElement>('.window-control[aria-label="关闭"]')!;
    const closeGlyph = closeButton.querySelector<HTMLElement>(".window-close-icon")!;
    const titlebarBox = titlebar.getBoundingClientRect();
    const buttonBox = closeButton.getBoundingClientRect();
    const glyphBox = closeGlyph.getBoundingClientRect();
    return {
      documentOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      bodyOverflow: document.body.scrollHeight - document.body.clientHeight,
      shellOverflow: shellScroller ? shellScroller.scrollHeight - shellScroller.clientHeight : null,
      shellOverflowStyle: shellScroller ? getComputedStyle(shellScroller).overflow : null,
      buttonCenterOffset: Math.abs((buttonBox.top + buttonBox.height / 2) - (titlebarBox.top + titlebarBox.height / 2)),
      glyphCenterOffset: Math.abs((glyphBox.top + glyphBox.height / 2) - (buttonBox.top + buttonBox.height / 2))
    };
  });
  expect(metrics).toMatchObject({ documentOverflow: 0, bodyOverflow: 0, shellOverflow: 0, shellOverflowStyle: "hidden" });
  expect(metrics.buttonCenterOffset).toBeLessThanOrEqual(0.5);
  expect(metrics.glyphCenterOffset).toBeLessThanOrEqual(0.5);
};

const selectLayout = async (window: Page, label: string): Promise<void> => {
  await window.getByRole("button", { name: /切换窗格布局/ }).click();
  await window.locator('[data-dropdown-option="true"]').getByText(label, { exact: true }).click();
};

test("keeps Electron and Chromium data beside the unpacked executable", async () => {
  test.setTimeout(120_000);
  const sourceExecutable = process.env.CODEX_PANE_PACKAGED_EXE;
  test.skip(!sourceExecutable, "Set CODEX_PANE_PACKAGED_EXE to run the unpacked executable data-path test.");
  const runRoot = resolve("E:\\AI-Workspace\\tmp", `codex-pane-unpacked-${randomUUID()}`);
  const unpackedRoot = join(runRoot, "win-unpacked");
  const isolatedAppData = join(runRoot, "appdata");
  const executablePath = join(unpackedRoot, "Codex Pane.exe");
  const expectedDataPath = join(unpackedRoot, "data");
  let application: ElectronApplication | null = null;
  let secondApplication: ElectronApplication | null = null;
  try {
    await mkdir(runRoot, { recursive: true });
    await cp(dirname(sourceExecutable!), unpackedRoot, { recursive: true });
    await rm(expectedDataPath, { recursive: true, force: true });
    const legacyBrowserDirectory = join(expectedDataPath, "Local Storage");
    const legacyMarker = join(legacyBrowserDirectory, "legacy-browser-data.txt");
    await mkdir(legacyBrowserDirectory, { recursive: true });
    await writeFile(legacyMarker, "preserve", "utf8");
    application = await launchWithDefaultDataPath(executablePath, isolatedAppData);
    const window = await application.firstWindow();
    await waitForWorkbench(window);
    await verifyWindowChrome(window);
    const paths = await application.evaluate(({ app }) => ({ userData: app.getPath("userData"), sessionData: app.getPath("sessionData") }));
    expect(paths.userData.toLowerCase()).toBe(expectedDataPath.toLowerCase());
    expect(paths.sessionData.toLowerCase()).toContain(join(expectedDataPath, "chromium").toLowerCase());
    expect(paths.sessionData.toLowerCase()).not.toBe(expectedDataPath.toLowerCase());
    await selectLayout(window, "四宫格");
    await window.waitForTimeout(800);
    const secondModelSelect = window.locator("[data-pane-id='pane-2'] .model-select");
    const secondComposer = window.locator("[data-pane-id='pane-2'] textarea");
    await secondModelSelect.click();
    await expect(window.locator(".n-base-select-menu")).toBeVisible();
    await expect(secondComposer).not.toBeFocused();
    await window.keyboard.press("Escape");
    expect(Number.parseFloat(await window.locator(".status-line").first().evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(await window.locator(".cwd-text").first().evaluate((element) => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);

    expect(existsSync(join(expectedDataPath, "workspaces", "default.json"))).toBe(true);
    expect(await readFile(legacyMarker, "utf8")).toBe("preserve");
    expect(existsSync(join(isolatedAppData, "codex-pane"))).toBe(false);

    secondApplication = await launchWithDefaultDataPath(executablePath, isolatedAppData);
    const secondWindow = await secondApplication.firstWindow();
    await waitForWorkbench(secondWindow);
    const secondPaths = await secondApplication.evaluate(({ app }) => ({ userData: app.getPath("userData"), sessionData: app.getPath("sessionData") }));
    expect(secondPaths.userData.toLowerCase()).toBe(expectedDataPath.toLowerCase());
    expect(secondPaths.sessionData.toLowerCase()).not.toBe(paths.sessionData.toLowerCase());
    expect(secondApplication.process().pid).not.toBe(application.process().pid);
    await application.close();
    application = null;
    await expect(secondWindow.getByRole("button", { name: "设置" })).toBeVisible();
  } finally {
    await application?.close();
    await secondApplication?.close();
    await rm(runRoot, { recursive: true, force: true });
  }
});

test("verifies the packaged Windows executable, protected persistence, reconnect, and shutdown", async () => {
  test.setTimeout(runLiveChecks ? 240_000 : 90_000);
  const executablePath = process.env.CODEX_PANE_PACKAGED_EXE;
  test.skip(!executablePath, "Set CODEX_PANE_PACKAGED_EXE to run the packaged executable smoke test.");
  const userDataPath = resolve("test-results", `packaged-user-data-${randomUUID()}`);
  let application = await launch(executablePath!, userDataPath);
  let trackedPids: number[] = [];
  try {
    const window = await application.firstWindow();
    const securityViolations: string[] = [];
    await window.exposeFunction("recordSecurityViolation", (directive: string) => securityViolations.push(directive));
    await window.evaluate(() => document.addEventListener("securitypolicyviolation", (event) => {
      void (window as unknown as { recordSecurityViolation: (directive: string) => Promise<void> }).recordSecurityViolation(event.violatedDirective);
    }));
    await expect(window).toHaveTitle("Codex Pane");
    await waitForWorkbench(window);
    const csp = await window.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(csp).not.toContain("__CODEX_PANE_CSP__");
    expect(csp).not.toMatch(/localhost|127\.0\.0\.1|ws:|unsafe-eval/i);

    const composer = window.getByPlaceholder(/发送消息/).first();
    await window.evaluate(() => (globalThis as typeof globalThis & { codexPane: { copyText: (value: string) => Promise<void> } }).codexPane.copyText("Codex Pane 复制测试"));
    expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe("Codex Pane 复制测试");
    await application.evaluate(({ clipboard }) => clipboard.writeText("https://example.com/pasted-image.png"));
    await composer.focus();
    await window.keyboard.press("Control+V");
    await expect(composer).toHaveValue("https://example.com/pasted-image.png");
    await expect(window.getByText("pasted-image.png", { exact: true })).toHaveCount(0);
    await composer.fill("");

    const firstTree = codexDescendants(application.process().pid!).map((process) => process.ProcessId);
    expect(firstTree.length).toBeGreaterThan(0);
    await window.evaluate(() => (globalThis as typeof globalThis & { codexPane: { reconnect: () => Promise<void> } }).codexPane.reconnect());
    await waitForGone(firstTree);
    await expect.poll(() => codexDescendants(application.process().pid!).length, { timeout: 20_000 }).toBeGreaterThan(0);
    trackedPids = codexDescendants(application.process().pid!).map((process) => process.ProcessId);
    expect(trackedPids.length).toBeGreaterThan(0);
    expect(securityViolations).toEqual([]);

    if (runLiveChecks) {
      await selectLayout(window, "单窗格");
      await composer.fill("只回复“Codex Pane 联调成功”，不要调用任何工具。");
      await composer.press("Enter");
      await expect(window.locator(".message-agent").last()).toContainText("Codex Pane 联调成功", { timeout: 90_000 });
      const shortReply = window.locator(".message-agent").last();
      expect((await shortReply.boundingBox())?.height ?? 1000).toBeLessThan(64);
      expect(await shortReply.locator(".copy-message-button").evaluate((element) => getComputedStyle(element).position)).toBe("absolute");
      const imagePath = resolve("node_modules/app-builder-lib/templates/icons/electron-linux/64x64.png");
      await application.evaluate(async ({ ClipboardItem, clipboard, nativeImage }, path) => {
        const png = Uint8Array.from(nativeImage.createFromPath(path).toPNG());
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([png], { type: "image/png" }) })]);
      }, imagePath);
      await composer.focus();
      await window.keyboard.press("Control+V");
      await expect(window.getByRole("button", { name: "移除 剪贴板图片.png" })).toBeVisible();
      await composer.fill("只回复“图片附件联调成功”，不要调用任何工具。");
      await composer.press("Enter");
      await expect(window.locator(".message-agent").last()).toContainText("图片附件联调成功", { timeout: 90_000 });
      await composer.fill("请使用命令工具执行 PowerShell 命令 Get-Location，然后用一句话说明当前目录。不要修改任何文件。");
      await composer.press("Enter");
      await expect(window.getByRole("heading", { name: /^Ran command/ }).last()).toBeVisible({ timeout: 90_000 });
      await expect(window.getByText(/Working/)).toHaveCount(0, { timeout: 30_000 });
    }
  } finally {
    await application.close();
  }
  await waitForGone(trackedPids);

  application = await launch(executablePath!, userDataPath);
  try {
    const window = await application.firstWindow();
    await waitForWorkbench(window);
    if (!runLiveChecks) await expect(window.getByPlaceholder(/发送消息/).first()).toHaveValue("");
    if (runLiveChecks) {
      await selectLayout(window, "四宫格");
      for (let index = 0; index < 4; index += 1) {
        const pane = window.locator(`[data-pane-id="pane-${index + 1}"]`);
        const paneComposer = pane.getByPlaceholder(/发送消息/);
        await paneComposer.fill("/new");
        await paneComposer.press("Enter");
        await paneComposer.press("Enter");
        await paneComposer.fill(`只回复“PANE-${index + 1}-OK”，不要调用任何工具。`);
      }
      for (let index = 0; index < 4; index += 1) {
        await window.locator(`[data-pane-id="pane-${index + 1}"]`).getByPlaceholder(/发送消息/).press("Enter");
      }
      for (let index = 0; index < 4; index += 1) {
        const messages = window.locator(`[data-pane-id="pane-${index + 1}"] .message-agent`);
        await expect(messages).toHaveCount(1, { timeout: 90_000 });
        await expect(messages.last()).toContainText(`PANE-${index + 1}-OK`, { timeout: 90_000 });
      }
    }
    trackedPids = codexDescendants(application.process().pid!).map((process) => process.ProcessId);
  } finally {
    await application.close();
  }
  await waitForGone(trackedPids);
});
