import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionState, FileReference, MediaAttachment, ProtocolEvent, SafeRequest, ServerResponse } from "../shared/contracts.js";
import type { WorkspaceState } from "../main/persistence.js";

const api = {
  bootstrap: (): Promise<{ connection: ConnectionState; workspace: WorkspaceState | null; workspaceWarning?: string | null }> => ipcRenderer.invoke("app:bootstrap"),
  request: (request: SafeRequest): Promise<unknown> => ipcRenderer.invoke("codex:request", request),
  respond: (response: ServerResponse): Promise<void> => ipcRenderer.invoke("codex:respond", response),
  reconnect: (): Promise<void> => ipcRenderer.invoke("codex:reconnect"),
  setAppServerWorkingDirectory: (path: string | null): Promise<void> => ipcRenderer.invoke("codex:working-directory", path),
  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:directory"),
  chooseImage: (limit: number): Promise<MediaAttachment[]> => ipcRenderer.invoke("media:choose", limit),
  chooseFiles: (limit: number): Promise<FileReference[]> => ipcRenderer.invoke("file:choose", limit),
  pasteClipboardImage: (): Promise<MediaAttachment> => ipcRenderer.invoke("media:clipboard"),
  importImagePath: (path: string): Promise<MediaAttachment> => ipcRenderer.invoke("media:path", path),
  addRemoteImage: (url: string): Promise<MediaAttachment> => ipcRenderer.invoke("media:remote", url),
  saveWorkspace: (state: WorkspaceState): Promise<void> => ipcRenderer.invoke("workspace:save", state),
  setFullScreen: (fullScreen: boolean): Promise<void> => ipcRenderer.invoke("window:fullscreen", fullScreen),
  windowControl: (action: "minimize" | "maximize" | "close"): Promise<void> => ipcRenderer.invoke("window:control", action),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("external:open", url),
  listSystemFonts: (): Promise<string[]> => ipcRenderer.invoke("system:fonts"),
  readDiagnostics: (): Promise<string[]> => ipcRenderer.invoke("diagnostics:read"),
  onConnectionState: (listener: (state: ConnectionState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: ConnectionState): void => listener(state);
    ipcRenderer.on("codex:state", handler);
    return () => ipcRenderer.removeListener("codex:state", handler);
  },
  onProtocolEvent: (listener: (event: ProtocolEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, protocolEvent: ProtocolEvent): void => listener(protocolEvent);
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.removeListener("codex:event", handler);
  },
  onFullScreenChange: (listener: (fullScreen: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fullScreen: boolean): void => listener(fullScreen);
    ipcRenderer.on("window:fullscreen-changed", handler);
    return () => ipcRenderer.removeListener("window:fullscreen-changed", handler);
  },
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => listener(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  }
};

contextBridge.exposeInMainWorld("codexPane", api);

export type CodexPaneApi = typeof api;
