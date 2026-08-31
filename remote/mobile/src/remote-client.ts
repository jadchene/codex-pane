import { desktopEventSchema, type DesktopEvent, type MobileCommand } from "@codex-pane/remote-protocol";

export class RemoteClient {
  readonly #onEvent: (event: DesktopEvent) => void;
  readonly #onState: (state: "connected" | "disconnected", message: string) => void;
  #started = false;

  constructor(onEvent: (event: DesktopEvent) => void, onState: (state: "connected" | "disconnected", message: string) => void) {
    this.#onEvent = onEvent;
    this.#onState = onState;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    window.addEventListener("message", this.#handleMessage);
    window.parent.postMessage({ source: "codex-pane-mobile-ui", type: "ready" }, "*");
    window.parent.postMessage({ source: "codex-pane-mobile-ui", type: "command", command: { type: "snapshot.get", requestId: crypto.randomUUID() } }, "*");
    this.#onState("connected", "安全连接已建立");
  }

  stop(): void {
    this.#started = false;
    window.removeEventListener("message", this.#handleMessage);
  }

  send(command: MobileCommand): void {
    if (!this.#started) throw new Error("桌面连接尚未恢复。");
    window.parent.postMessage({ source: "codex-pane-mobile-ui", type: "command", command }, "*");
  }

  readonly #handleMessage = (message: MessageEvent): void => {
    if (message.source !== window.parent || !message.data || message.data.source !== "codex-pane-bootstrap") return;
    if (message.data.type === "disconnected") {
      this.#onState("disconnected", typeof message.data.message === "string" ? message.data.message : "桌面连接已断开");
      return;
    }
    if (message.data.type !== "event") return;
    try { this.#onEvent(desktopEventSchema.parse(message.data.event)); }
    catch { this.#onState("disconnected", "收到无法识别的桌面消息"); }
  };
}
