import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { WebSocket } from "ws";

const sessionFixtureMarker = resolve(".session-fixture");

const isolatedEnv = (requestLog: string): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  CODEX_PANE_LOAD_DIST: "1",
  CODEX_PANE_USER_DATA_DIR: resolve("test-results", `remote-user-data-${randomUUID()}`),
  CODEX_PANE_REQUEST_LOG: requestLog,
  CODEX_PANE_DISABLE_HARDWARE_ACCELERATION: "1"
});

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a relay port");
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return address.port;
};

const waitForRelay = async (origin: string, process: ChildProcess): Promise<void> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Relay exited with code ${process.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch { /* Relay is still starting. */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Relay did not become healthy");
};

const expectMobileRejected = async (origin: string, attach: (challenge: { connectionId: string; nonce: string }) => unknown): Promise<string> => new Promise((resolvePromise, reject) => {
  const url = new URL(origin);
  url.protocol = "ws:";
  url.pathname = "/ws";
  const socket = new WebSocket(url);
  const timeout = setTimeout(() => { socket.terminate(); reject(new Error("Unknown mobile connection was not rejected")); }, 5_000);
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw)) as { type?: string; connectionId?: string; nonce?: string };
    if (message.type === "relay.challenge" && message.connectionId && message.nonce) socket.send(JSON.stringify(attach({ connectionId: message.connectionId, nonce: message.nonce })));
  });
  socket.on("close", (code, reason) => {
    clearTimeout(timeout);
    if (code !== 1008) return reject(new Error(`Unknown mobile closed with unexpected code ${code}`));
    resolvePromise(String(reason));
  });
  socket.on("error", reject);
});

const openMobileWindow = async (application: ElectronApplication, url: string): Promise<Page> => {
  const existing = new Set(application.windows());
  await application.evaluate(async ({ BrowserWindow }, target) => {
    const window = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await window.loadURL(target);
  }, url);
  await expect.poll(() => application.windows().length).toBeGreaterThan(existing.size);
  const mobile = application.windows().find((window) => !existing.has(window));
  if (!mobile) throw new Error("Mobile test window was not created");
  return mobile;
};

test("completes the real thin-relay pairing, Passkey, E2EE, UI delivery, and conversation flow", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const requestLog = resolve("test-results", `remote-app-server-${randomUUID()}.jsonl`);
  await Promise.all([writeFile(sessionFixtureMarker, "", "utf8"), writeFile(requestLog, "", "utf8")]);
  const port = await freePort();
  const relayOrigin = `http://localhost:${port}`;
  const relay = spawn(process.execPath, [resolve("remote", "relay", "dist", "server.js")], {
    cwd: resolve("remote", "relay"),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: relayOrigin },
    stdio: ["ignore", "pipe", "pipe"]
  });
  relay.stderr?.on("data", (data) => process.stdout.write(`[relay:stderr] ${String(data)}`));
  await waitForRelay(relayOrigin, relay);

  const application = await electron.launch({ args: ["--no-sandbox", "--disable-gpu", "--in-process-gpu", "--use-angle=swiftshader", "--use-gl=angle", resolve(".")], env: isolatedEnv(requestLog) });
  let mobile: Page | null = null;
  try {
    application.process().stderr?.on("data", (data) => process.stdout.write(`[remote-electron:stderr] ${String(data)}`));
    const desktop = await application.firstWindow();
    await desktop.getByRole("button", { name: "设置" }).click();
    const settings = desktop.getByRole("dialog").filter({ hasText: "远程访问" });
    await settings.locator(".n-form-item").filter({ hasText: "启用远程访问" }).getByRole("switch").click();
    await settings.getByPlaceholder("https://pane.example.com").fill(relayOrigin);
    await settings.getByRole("button", { name: "保存并连接" }).click();
    await expect(settings.getByText("已连接中转服务", { exact: true })).toBeVisible({ timeout: 10_000 });
    await settings.getByRole("button", { name: "生成配对二维码" }).click();
    const pairingStatus = await desktop.evaluate(() => window.codexPane.getRemoteAccessStatus());
    if (!pairingStatus.pairing) throw new Error("Desktop did not create a pairing URL");
    const pairingPayload = new URL(pairingStatus.pairing.url).hash.slice(1);
    const encodedPairing = new URLSearchParams(pairingPayload).get("pair");
    if (!encodedPairing) throw new Error("Pairing URL did not contain protected channel data");
    const pairingData = JSON.parse(Buffer.from(encodedPairing, "base64url").toString("utf8")) as { channelId: string };
    await expectMobileRejected(relayOrigin, ({ connectionId, nonce }) => ({
      type: "mobile.attach", protocolVersion: 1, mode: "device", channelId: pairingData.channelId,
      deviceId: randomUUID(), timestamp: Date.now(), signature: Buffer.from(`${connectionId}:${nonce}`).toString("base64url")
    }));

    mobile = await openMobileWindow(application, pairingStatus.pairing.url);
    const cdp = await application.context().newCDPSession(mobile);
    await cdp.send("WebAuthn.enable");
    const authenticator = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true
      }
    });
    await mobile.bringToFront();
    await mobile.getByRole("button", { name: "创建 Passkey" }).click();
    await mobile.waitForTimeout(2_000);
    await expect(settings.getByText("手机已登记，请核对确认码", { exact: true })).toBeVisible({ timeout: 15_000 });
    await settings.getByRole("button", { name: "确认并完成绑定" }).click();
    await expect(settings.getByText("手机已绑定", { exact: true })).toBeVisible({ timeout: 10_000 });

    await expect(mobile.getByRole("button", { name: "使用 Passkey 登录" })).toBeVisible({ timeout: 15_000 });
    await mobile.getByRole("button", { name: "使用 Passkey 登录" }).click();
    const frame = mobile.frameLocator("#mobile-frame");
    const sessionMenu = frame.getByRole("button", { name: "打开会话列表" });
    await expect(sessionMenu).toBeVisible({ timeout: 20_000 });
    await sessionMenu.click();
    await expect(frame.getByRole("complementary", { name: "最近会话" })).toBeVisible();
    await expect.poll(async () => (await readFile(requestLog, "utf8")).includes('"method":"thread/list"')).toBe(true);
    await expect.poll(() => frame.locator("body").textContent()).toContain("示例会话 A");
    await frame.getByRole("button", { name: /示例会话 A/ }).click();
    await expect(frame.getByRole("heading", { name: "示例会话 A" })).toBeVisible();
    await frame.getByPlaceholder("输入消息…").fill("来自手机端的加密消息");
    await frame.getByRole("button", { name: "发送" }).click();

    await expect.poll(async () => {
      const lines = (await readFile(requestLog, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> });
      return lines.some((line) => line.method === "turn/start" && line.params.threadId === "fixture-thread-a");
    }).toBe(true);

    await desktop.evaluate(() => window.codexPane.logoutAllRemoteMobiles());
    await expect(mobile.getByRole("button", { name: "使用 Passkey 登录" })).toBeVisible({ timeout: 15_000 });
    await mobile.getByRole("button", { name: "使用 Passkey 登录" }).click();
    await expect(mobile.frameLocator("#mobile-frame").getByRole("button", { name: "打开会话列表" })).toBeVisible({ timeout: 15_000 });

    const currentStatus = await desktop.evaluate(() => window.codexPane.getRemoteAccessStatus());
    await desktop.evaluate((credentialId) => window.codexPane.revokeRemotePasskey(credentialId), currentStatus.passkeys[0]!.id);
    await expect(mobile.getByText("这部手机的访问权限已撤销，请在桌面端重新生成二维码。", { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await testInfo.attach("remote-app-server-requests", { body: await readFile(requestLog, "utf8"), contentType: "application/jsonl" });
    await application.close();
    relay.kill();
    await Promise.all([rm(sessionFixtureMarker, { force: true }), rm(requestLog, { force: true })]);
  }
});
