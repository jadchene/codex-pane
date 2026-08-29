import { basename, dirname, extname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, safeStorage, screen, shell } from "electron";
import { AppServerSupervisor } from "./app-server-supervisor.js";
import { FileStore } from "./file-store.js";
import { MediaStore } from "./media-store.js";
import { StateStore, type WorkspaceState } from "./persistence.js";
import { safeRequestSchema, serverResponseSchema, type AttachmentBatch, type ProtocolEvent } from "../shared/contracts.js";
import { RuntimeProtocolValidator } from "../../packages/protocol/src/runtime-validator.js";
import { DiagnosticLog } from "./diagnostic-log.js";
import { useCodexArgsPrefixForTests, useCodexFixtureForTests } from "./codex-process.js";
import { prepareUserDataLocation } from "./user-data-location.js";
import { isTrustedRendererUrl, rendererEntryUrl } from "./renderer-trust.js";
import { fitWindowBounds } from "./window-bounds.js";
import { mediaRequestId } from "./media-protocol.js";

protocol.registerSchemesAsPrivileged([
  { scheme: "codex-media", privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);

if (!app.isPackaged && process.env.CODEX_PANE_PERFORMANCE_FIXTURE === "1") app.disableHardwareAcceleration();

if (!app.isPackaged && (existsSync(join(app.getAppPath(), ".approval-fixture")) || existsSync(join(app.getAppPath(), ".session-fixture")))) {
  useCodexFixtureForTests(join(app.getAppPath(), "tests", "fixtures", "fake-codex", "fake-app-server.mjs"));
}
if (!app.isPackaged && process.env.CODEX_PANE_PERFORMANCE_FIXTURE === "1") {
  useCodexFixtureForTests(join(app.getAppPath(), "tests", "fixtures", "fake-codex", "performance-app-server.mjs"));
}
if (!app.isPackaged && existsSync(join(app.getAppPath(), ".user-approval-fixture"))) {
  useCodexArgsPrefixForTests(["-c", "approvals_reviewer='user'"]);
}

const fallbackUserDataPath = join(app.getPath("appData"), app.getName());
const userDataLocation = prepareUserDataLocation({
  explicitPath: process.env.CODEX_PANE_USER_DATA_DIR,
  executablePath: app.getPath("exe"),
  applicationPath: app.getAppPath(),
  fallbackUserDataPath,
  packaged: app.isPackaged
});
app.setPath("userData", userDataLocation.path);
const chromiumRoot = join(userDataLocation.path, "chromium");
const primarySessionLock = join(chromiumRoot, ".primary-instance-lock");
const primarySessionLockPid = join(primarySessionLock, "pid");

const processExists = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

const removePrimarySessionLock = (): void => {
  try {
    if (existsSync(primarySessionLockPid)) unlinkSync(primarySessionLockPid);
    if (existsSync(primarySessionLock)) rmdirSync(primarySessionLock);
  } catch {
    // A concurrent process may have observed or replaced a stale lock.
  }
};

const acquirePrimarySession = (): boolean => {
  mkdirSync(chromiumRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(primarySessionLock);
      writeFileSync(primarySessionLockPid, String(process.pid), { encoding: "utf8", flag: "wx" });
      return true;
    } catch {
      let ownerPid = 0;
      try {
        ownerPid = Number(readFileSync(primarySessionLockPid, "utf8").trim());
      } catch {
        return false;
      }
      if (processExists(ownerPid)) return false;
      removePrimarySessionLock();
    }
  }
  return false;
};

const ownsPrimarySession = acquirePrimarySession();
app.setPath("sessionData", join(chromiumRoot, ownsPrimarySession ? "primary" : String(process.pid)));

let mainWindow: BrowserWindow | null = null;
const fallbackAppServerWorkingDirectory = app.isPackaged ? dirname(app.getPath("exe")) : app.getAppPath();
const loadBundledRenderer = app.isPackaged || process.env.CODEX_PANE_LOAD_DIST === "1";
const trustedRendererUrl = rendererEntryUrl(app.getAppPath(), loadBundledRenderer);
const supervisor = new AppServerSupervisor(fallbackAppServerWorkingDirectory, app.getVersion());
let mediaStore: MediaStore;
let fileStore: FileStore;
let stateStore: StateStore;
let diagnosticLog: DiagnosticLog;
let forceClosing = false;
let shutdownInProgress = false;
let windowSaveTimer: NodeJS.Timeout | null = null;
const execFileAsync = promisify(execFile);

const listWindowsFonts = async (): Promise<string[]> => {
  if (process.platform !== "win32") return [];
  const registryKeys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"
  ];
  const results = await Promise.allSettled(registryKeys.map((key) => execFileAsync("reg.exe", ["query", key], { windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })));
  const fontNames = results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    return result.value.stdout.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s{4}(.+?)\s+REG_(?:SZ|EXPAND_SZ)\s+/);
      if (!match?.[1]) return [];
      const name = match[1].replace(/\s+\((?:TrueType|OpenType)\)$/i, "").trim();
      return name ? [name] : [];
    });
  });
  return [...new Set(fontNames)].sort((left, right) => left.localeCompare(right, "zh-CN"));
};

const shutdownApplication = async (): Promise<void> => {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  try {
    await supervisor.stop();
    if (ownsPrimarySession) removePrimarySessionLock();
    forceClosing = true;
    mainWindow?.destroy();
    app.exit(0);
  } catch (error) {
    shutdownInProgress = false;
    mainWindow?.webContents.send("codex:state", {
      ...supervisor.state,
      phase: "error",
      message: `无法安全退出 Codex：${error instanceof Error ? error.message : String(error)}`
    });
  }
};

const scheduleWindowStateSave = (): void => {
  if (!mainWindow || !stateStore) return;
  if (windowSaveTimer) clearTimeout(windowSaveTimer);
  windowSaveTimer = setTimeout(() => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    void stateStore.updateWindow({ ...bounds, maximized: mainWindow.isMaximized() });
  }, 300);
};

const transformManagedAttachments = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(transformManagedAttachments);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "managedImage" && typeof record.id === "string") {
    return { type: "localImage", path: mediaStore.resolveAttachment(record.id), detail: record.detail ?? "high" };
  }
  if (record.type === "managedRemoteImage" && typeof record.url === "string") {
    const url = new URL(record.url);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("远程图片必须使用不含账号信息的 HTTPS 地址。" );
    }
    return { type: "image", url: url.toString(), detail: record.detail ?? "high" };
  }
  if (record.type === "managedFile" && typeof record.id === "string" && typeof record.name === "string") {
    return { type: "mention", name: record.name, path: fileStore.resolveAttachment(record.id, record.name) };
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, transformManagedAttachments(entry)]));
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const importAttachmentPaths = async (paths: string[]): Promise<AttachmentBatch> => {
  const images = [];
  const files = [];
  for (const path of paths) {
    if (IMAGE_EXTENSIONS.has(extname(path).toLocaleLowerCase())) images.push(await mediaStore.importPath(path));
    else files.push(await fileStore.importPath(path));
  }
  return { images, files };
};

const clipboardFilePaths = async (): Promise<string[]> => {
  const paths: string[] = [];
  for (const item of await clipboard.read()) {
    for (const type of item.types) {
      const match = type.match(/(?:^|format=")filename(w?)(?:"|$)/i);
      if (!match) continue;
      const value = await item.getType(type);
      if (!(value instanceof Blob)) continue;
      const buffer = Buffer.from(await value.arrayBuffer());
      paths.push(...buffer.toString(match[1] ? "utf16le" : "utf8").split("\0").map((path) => path.trim()).filter(Boolean));
    }
  }
  return [...new Set(paths)].filter((path) => existsSync(path) && statSync(path).isFile());
};

const protectRemoteUrls = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const workspace = value as Record<string, unknown>;
  if (!Array.isArray(workspace.panes)) return value;
  return {
    ...workspace,
    panes: workspace.panes.map((rawPane) => {
      if (!rawPane || typeof rawPane !== "object") return rawPane;
      const pane = rawPane as Record<string, unknown>;
      const attachments = Array.isArray(pane.attachments) ? pane.attachments.map((rawAttachment) => {
        if (!rawAttachment || typeof rawAttachment !== "object") return rawAttachment;
        const attachment = rawAttachment as Record<string, unknown>;
        if (attachment.kind !== "remote" || typeof attachment.sourceUrl !== "string") return attachment;
        if (!safeStorage.isEncryptionAvailable()) throw new Error("系统凭据保护当前不可用，暂时无法保存远程图片草稿。" );
        const { sourceUrl, ...rest } = attachment;
        return { ...rest, protectedSourceUrl: safeStorage.encryptString(sourceUrl).toString("base64") };
      }) : pane.attachments;
      return { ...pane, attachments };
    })
  };
};

const unprotectRemoteUrls = (workspace: WorkspaceState | null): WorkspaceState | null => {
  if (!workspace) return null;
  return {
    ...workspace,
    panes: workspace.panes.map((pane) => ({
      ...pane,
      attachments: pane.attachments.flatMap((attachment) => {
        if (attachment.kind !== "remote" || !attachment.protectedSourceUrl) return [attachment];
        try {
          const sourceUrl = safeStorage.decryptString(Buffer.from(attachment.protectedSourceUrl, "base64"));
          const { protectedSourceUrl: _protectedSourceUrl, ...rest } = attachment;
          return [{ ...rest, sourceUrl }];
        } catch {
          return [];
        }
      })
    }))
  };
};

const createWindow = async (): Promise<void> => {
  const workspace = await stateStore.load();
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const restoredBounds = fitWindowBounds({
    width: workspace?.window.width ?? 1480,
    height: workspace?.window.height ?? 920,
    x: workspace?.window.x,
    y: workspace?.window.y
  }, displays.map((display) => display.workArea), Math.max(0, displays.findIndex((display) => display.id === primaryDisplay.id)));
  mainWindow = new BrowserWindow({
    ...restoredBounds,
    minWidth: 960,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: workspace?.appearance?.theme === "light" ? "#ffffff" : "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(app.getAppPath(), "dist-electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      allowRunningInsecureContent: false
    }
  });
  if (workspace?.window.maximized) {
    mainWindow.maximize();
  }
  const isTrustedLocalPage = (url: string): boolean => isTrustedRendererUrl(url, trustedRendererUrl);
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return webContents === mainWindow?.webContents
      && String(permission) === "local-fonts"
      && isTrustedLocalPage(webContents.getURL())
      && (isTrustedLocalPage(requestingOrigin) || loadBundledRenderer && requestingOrigin === "file://");
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(webContents === mainWindow?.webContents
      && String(permission) === "local-fonts"
      && isTrustedLocalPage(webContents.getURL())
      && isTrustedLocalPage(details.requestingUrl));
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Codex Pane renderer exited: ${details.reason} (${details.exitCode})`);
  });
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("maximize", () => mainWindow?.webContents.send("window:maximized-changed", true));
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window:maximized-changed", false));
  mainWindow.on("enter-full-screen", () => mainWindow?.webContents.send("window:fullscreen-changed", true));
  mainWindow.on("leave-full-screen", () => mainWindow?.webContents.send("window:fullscreen-changed", false));
  mainWindow.on("close", (event) => {
    if (forceClosing) return;
    event.preventDefault();
    if (!supervisor.hasActiveWork) {
      void shutdownApplication();
      return;
    }
    void dialog.showMessageBox(mainWindow!, {
      type: "warning",
      title: "Codex 仍在运行",
      message: "仍有任务或确认请求未完成。要先中断它们再退出吗？",
      detail: "直接退出不会让 Codex 在后台继续运行，也不会自动重发未完成的操作。",
      buttons: ["返回", "中断并退出"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(async ({ response }) => {
      if (response !== 1) return;
      await supervisor.interruptActiveWork();
      await shutdownApplication();
    });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedLocalPage(url)) event.preventDefault();
  });
  if (loadBundledRenderer) {
    await mainWindow.loadFile(join(app.getAppPath(), "dist/index.html"));
  } else {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  }
};

const registerIpc = (): void => {
  const assertTrustedSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (!mainWindow
      || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame
      || !isTrustedRendererUrl(event.senderFrame.url, trustedRendererUrl)) {
      throw new Error("已拒绝来自未知页面的应用调用。" );
    }
  };
  ipcMain.handle("app:bootstrap", async (event) => {
    assertTrustedSender(event);
    const workspace = unprotectRemoteUrls(await stateStore.load());
    return {
      connection: supervisor.state,
      workspace,
      workspaceWarning: [userDataLocation.warning, stateStore.loadWarning].filter(Boolean).join(" ") || null
    };
  });
  ipcMain.handle("system:fonts", async (event) => {
    assertTrustedSender(event);
    return listWindowsFonts();
  });
  ipcMain.handle("codex:request", async (event, rawRequest: unknown) => {
    assertTrustedSender(event);
    const request = safeRequestSchema.parse(rawRequest);
    return supervisor.call(request.method, transformManagedAttachments(request.params));
  });
  ipcMain.handle("codex:respond", async (event, rawResponse: unknown) => {
    assertTrustedSender(event);
    const response = serverResponseSchema.parse(rawResponse);
    supervisor.respondToServer(response.generation, response.id, response.result, response.error);
  });
  ipcMain.handle("codex:reconnect", async (event) => {
    assertTrustedSender(event);
    await supervisor.stop();
    await supervisor.start();
  });
  ipcMain.handle("codex:working-directory", async (event, rawPath: unknown) => {
    assertTrustedSender(event);
    if (rawPath !== null && (typeof rawPath !== "string" || rawPath.length > 32_768)) throw new Error("全局默认工作目录无效。");
    const workingDirectory = rawPath ? resolve(rawPath) : fallbackAppServerWorkingDirectory;
    if (!existsSync(workingDirectory) || !statSync(workingDirectory).isDirectory()) throw new Error("全局默认工作目录不存在或不是目录。");
    supervisor.setWorkingDirectory(workingDirectory);
  });
  ipcMain.handle("dialog:directory", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "选择 Codex 工作目录", properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("attachment:choose", async (event, rawLimit: unknown) => {
    assertTrustedSender(event);
    if (!Number.isInteger(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 20) throw new Error("可添加附件数量无效。");
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "添加附件（可多选）",
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled) return { images: [], files: [] };
    return importAttachmentPaths(result.filePaths.slice(0, Number(rawLimit)));
  });
  ipcMain.handle("attachment:paste", async (event, rawPaths: unknown, rawLimit: unknown) => {
    assertTrustedSender(event);
    if (!Array.isArray(rawPaths) || rawPaths.length > 20 || rawPaths.some((path) => typeof path !== "string" || path.length > 32_768)) throw new Error("剪贴板文件路径无效。");
    if (!Number.isInteger(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 20) throw new Error("可添加附件数量无效。");
    const suggestedPaths = rawPaths.map((path) => resolve(path)).filter((path) => existsSync(path) && statSync(path).isFile());
    const paths = (suggestedPaths.length ? suggestedPaths : await clipboardFilePaths()).slice(0, Number(rawLimit));
    if (paths.length) return importAttachmentPaths(paths);
    return { images: [await mediaStore.pasteClipboard()], files: [] };
  });
  ipcMain.handle("media:path", (event, path: unknown) => {
    assertTrustedSender(event);
    if (typeof path !== "string" || path.length > 32_768) {
      throw new Error("图片路径无效。" );
    }
    return mediaStore.importPath(path);
  });
  ipcMain.handle("media:remote", (event, rawUrl: unknown) => {
    assertTrustedSender(event);
    if (typeof rawUrl !== "string" || rawUrl.length > 8_192) {
      throw new Error("图片地址无效。" );
    }
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("远程图片必须使用不含账号信息的 HTTPS 地址。" );
    }
    const extension = url.pathname.match(/\.(png|jpe?g|webp|gif|bmp)$/i)?.[1];
    if (!extension) {
      throw new Error("这个地址看起来不是受支持的图片。请使用以 png、jpg、webp、gif 或 bmp 结尾的 HTTPS 地址。" );
    }
    const id = crypto.randomUUID();
    return { id, name: url.pathname.split("/").pop() || `远程图片.${extension}`, url: "codex-media://media/remote", size: 0, kind: "remote", sourceUrl: url.toString() };
  });
  ipcMain.handle("workspace:save", (event, state: unknown) => {
    assertTrustedSender(event);
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("工作台状态无效。" );
    }
    const bounds = mainWindow?.getBounds();
    if (!bounds) {
      throw new Error("主窗口尚未就绪。" );
    }
    return stateStore.save(protectRemoteUrls({
      ...state,
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: mainWindow?.isMaximized() ?? false
      }
    }));
  });
  ipcMain.handle("window:fullscreen", (event, fullScreen: unknown) => {
    assertTrustedSender(event);
    if (typeof fullScreen !== "boolean") {
      throw new Error("全屏参数无效。" );
    }
    mainWindow?.setFullScreen(fullScreen);
  });
  ipcMain.handle("window:control", (event, action: unknown) => {
    assertTrustedSender(event);
    if (action === "minimize") mainWindow?.minimize();
    else if (action === "maximize") mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
    else if (action === "close") mainWindow?.close();
    else throw new Error("窗口操作无效。");
  });
  ipcMain.handle("window:is-maximized", (event) => {
    assertTrustedSender(event);
    return mainWindow?.isMaximized() ?? false;
  });
  ipcMain.handle("clipboard:write-text", async (event, rawValue: unknown) => {
    assertTrustedSender(event);
    if (typeof rawValue !== "string" || rawValue.length > 2_000_000) throw new Error("复制内容无效。");
    await clipboard.writeText(rawValue);
  });
  ipcMain.handle("external:open", async (event, rawUrl: unknown) => {
    assertTrustedSender(event);
    if (typeof rawUrl !== "string" || rawUrl.length > 8_192) {
      throw new Error("链接无效。" );
    }
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("只允许打开 HTTP 或 HTTPS 链接。" );
    }
    const confirmation = await dialog.showMessageBox(mainWindow!, {
      type: "question",
      title: "打开外部链接？",
      message: `即将在系统浏览器中打开 ${url.host}`,
      detail: "请确认这是你信任的网站。Codex Pane 不会在应用内加载该页面。",
      buttons: ["取消", "打开"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return;
    await shell.openExternal(url.toString());
  });
  ipcMain.handle("diagnostics:read", (event) => { assertTrustedSender(event); return diagnosticLog.tail(); });
};

const pendingDeltaEvents = new Map<string, ProtocolEvent>();
let deltaBatchTimer: NodeJS.Timeout | null = null;
const flushDeltaEvents = (): void => {
  if (deltaBatchTimer) clearTimeout(deltaBatchTimer);
  deltaBatchTimer = null;
  if (!pendingDeltaEvents.size) return;
  const events = [...pendingDeltaEvents.values()];
  pendingDeltaEvents.clear();
  const generations = new Map<number, ProtocolEvent[]>();
  for (const event of events) {
    const generationEvents = generations.get(event.generation) ?? [];
    generationEvents.push(event);
    generations.set(event.generation, generationEvents);
  }
  for (const [generation, generationEvents] of generations) {
    mainWindow?.webContents.send("codex:event", { generation, kind: "notification-batch", payload: generationEvents });
  }
};
const bufferDeltaEvent = (event: ProtocolEvent): boolean => {
  if (event.kind !== "notification") return false;
  const envelope = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
  const method = typeof envelope.method === "string" ? envelope.method : "";
  if (!method.includes("/delta") && !method.endsWith("outputDelta")) return false;
  const params = envelope.params && typeof envelope.params === "object" ? envelope.params as Record<string, unknown> : {};
  const field = typeof params.delta === "string" ? "delta" : typeof params.output === "string" ? "output" : null;
  if (!field) return false;
  const key = [event.generation, method, params.threadId, params.turnId, params.itemId].map(String).join(":");
  const previous = pendingDeltaEvents.get(key);
  if (previous) {
    const previousEnvelope = previous.payload as Record<string, unknown>;
    const previousParams = previousEnvelope.params as Record<string, unknown>;
    previousParams[field] = `${typeof previousParams[field] === "string" ? previousParams[field] : ""}${typeof params[field] === "string" ? params[field] : ""}`;
  } else {
    pendingDeltaEvents.set(key, { ...event, payload: { ...envelope, params: { ...params } } });
  }
  if (!deltaBatchTimer) deltaBatchTimer = setTimeout(flushDeltaEvents, 0);
  return true;
};
supervisor.on("state", (state) => {
  if (pendingDeltaEvents.size) flushDeltaEvents();
  mainWindow?.webContents.send("codex:state", state);
});
supervisor.on("protocol", (event) => {
  if (event.kind === "diagnostic") {
    void diagnosticLog?.write(event.payload).catch(() => undefined);
    return;
  }
  if (bufferDeltaEvent(event)) return;
  if (event.kind === "notification" && pendingDeltaEvents.size) flushDeltaEvents();
  mainWindow?.webContents.send("codex:event", event);
});

app.whenReady().then(async () => {
  const dataDirectory = app.getPath("userData");
  mediaStore = new MediaStore(join(dataDirectory, "media"));
  fileStore = new FileStore(join(dataDirectory, "files"));
  await Promise.all([mediaStore.initialize(), fileStore.initialize()]);
  stateStore = new StateStore(join(dataDirectory, "workspaces", "default.json"));
  const persistedWorkspace = await stateStore.load();
  const initialWorkingDirectory = persistedWorkspace?.defaultCwd || fallbackAppServerWorkingDirectory;
  if (existsSync(initialWorkingDirectory) && statSync(initialWorkingDirectory).isDirectory()) {
    supervisor.setWorkingDirectory(initialWorkingDirectory);
  }
  diagnosticLog = new DiagnosticLog(join(dataDirectory, "logs"));
  await diagnosticLog.initialize();
  protocol.handle("codex-media", async (request) => {
    const id = mediaRequestId(request.url, request.method);
    if (!id) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" } });
    const bytes = await mediaStore.read(id);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  });
  registerIpc();
  await createWindow();
  try {
    supervisor.setRuntimeValidator(new RuntimeProtocolValidator(join(app.getAppPath(), "packages", "protocol", "schema", "generated")));
  } catch (error) {
    mainWindow?.webContents.send("codex:event", {
      generation: 0,
      kind: "diagnostic",
      payload: { level: "warning", message: `协议 Schema 加载失败，已保留基础消息校验：${error instanceof Error ? error.message : String(error)}` }
    });
    mainWindow?.webContents.send("codex:state", {
      phase: "error",
      generation: 0,
      codexVersion: null,
      compatible: false,
      message: "固定协议 Schema 加载失败。为避免错误审批或写入，Codex Pane 已停止连接；请重新安装应用。"
    });
    return;
  }
  try {
    await supervisor.start();
  } catch (error) {
    mainWindow?.webContents.send("codex:state", { ...supervisor.state, phase: "error", message: error instanceof Error ? error.message : String(error) });
  }
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  if (ownsPrimarySession) removePrimarySessionLock();
});
app.on("before-quit", (event) => {
  if (forceClosing || !supervisor.isRunning) return;
  event.preventDefault();
  void shutdownApplication();
});
