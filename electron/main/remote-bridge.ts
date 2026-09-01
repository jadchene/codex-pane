import { EventEmitter } from "node:events";
import { createHash, randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { z } from "zod";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { AppServerSupervisor } from "./app-server-supervisor.js";
import type { ConnectionState, ProtocolEvent, RemoteAccessStatus, RemotePairingInfo, RemoteSettings } from "../shared/contracts.js";
import {
  mobileCommandSchema,
  pairingHelloSchema,
  peerPayloadSchema,
  sessionHelloProof,
  sessionWelcomeProof,
  uiDocumentProof,
  type DesktopEvent,
  type MobileCommand,
  type MobileItem
} from "../../packages/remote-protocol/src/index.js";
import { RemoteCredentialStore, type RemoteCredentialState, type RemoteMobileDevice } from "./remote-credential-store.js";
import { deriveSessionKey, generateP256KeyPair, SecureSession, signP256, verifyP256 } from "./remote-crypto.js";
import { RemotePasskeyService } from "./remote-passkey.js";
import { RelayConnection, type RelayConnectionEvent } from "./relay-connection.js";
import { RemoteAuditLog } from "./remote-audit-log.js";
import { RemoteProjector, sanitizeRemoteActivityText } from "./remote-projector.js";
import { ServerRequestCoordinator } from "./server-request-coordinator.js";
import { SerialTaskQueue } from "./serial-task-queue.js";
import { ThreadSubscriptionRegistry } from "./thread-subscription-registry.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value : "";
const MAX_MOBILE_DOCUMENT_BYTES = 2 * 1024 * 1024;

type PairingState = {
  pairingId: string;
  secret: string;
  hash: string;
  code: string;
  expiresAt: number;
  readyToConfirm: boolean;
  peerId?: string;
};

type PeerState = {
  peerId: string;
  mode: "device" | "pairing";
  deviceId?: string;
  dataQueue: SerialTaskQueue;
  secure?: SecureSession;
  authenticated: boolean;
  registrationChallenge?: string;
  authenticationChallenge?: string;
  pendingDevice?: RemoteMobileDevice;
};

const pairingStartSchema = z.object({
  type: z.literal("pairing.start"),
  pairingSecret: z.string().min(32).max(512),
  deviceId: z.string().uuid(),
  deviceName: z.string().min(1).max(200),
  signingPublicKey: z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string() }).passthrough(),
  agreementPublicKey: z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string() }).passthrough()
});

export class RemoteBridge extends EventEmitter {
  readonly #supervisor: AppServerSupervisor;
  readonly #credentialStore: RemoteCredentialStore;
  readonly #auditLog: RemoteAuditLog;
  readonly #projector = new RemoteProjector();
  readonly #coordinator: ServerRequestCoordinator;
  readonly #subscriptions: ThreadSubscriptionRegistry;
  readonly #requestResults = new Map<string, { at: number; event: DesktopEvent }>();
  readonly #pendingProjected = new Map<string, { threadId: string; item: MobileItem }>();
  readonly #peers = new Map<string, PeerState>();
  #projectTimer: NodeJS.Timeout | null = null;
  #credentials: RemoteCredentialState | null = null;
  #connection: RelayConnection | null = null;
  #passkeys: RemotePasskeyService | null = null;
  #pairing: PairingState | null = null;
  #policyRevision = 0;
  #seq = 0;
  #mobileDocument: string | null = null;
  #ownsRemoteAccess = true;
  #sessionDefaults: { cwd: string | null; model: string | null } = { cwd: null, model: null };
  #status: RemoteAccessStatus = { enabled: false, phase: "disabled", message: "远程访问已关闭", relayUrl: "", paired: false, pairing: null, passkeys: [] };

  constructor(supervisor: AppServerSupervisor, credentialStore: RemoteCredentialStore, auditLog: RemoteAuditLog) {
    super();
    this.#supervisor = supervisor;
    this.#credentialStore = credentialStore;
    this.#auditLog = auditLog;
    this.#coordinator = new ServerRequestCoordinator(supervisor);
    this.#subscriptions = new ThreadSubscriptionRegistry(supervisor);
  }

  get status(): RemoteAccessStatus { return structuredClone(this.#status); }

  async initialize(ownsRemoteAccess = true): Promise<void> {
    this.#ownsRemoteAccess = ownsRemoteAccess;
    this.#credentials = await this.#credentialStore.load();
    this.#projector.setConnection(this.#supervisor.state);
    if (!ownsRemoteAccess) {
      this.#showStandbyStatus();
      return;
    }
    if (this.#credentials?.enabled) this.#startConnection();
    else if (this.#credentials) this.#syncCredentialStatus();
  }

  async updateSettings(settings: RemoteSettings): Promise<RemoteAccessStatus> {
    this.#assertOwnership();
    let credentials = this.#credentials;
    if (!credentials) credentials = this.#credentialStore.createIdentity();
    credentials = { ...credentials, enabled: settings.enabled, relayUrl: settings.relayUrl.replace(/\/$/, "") };
    await this.#credentialStore.save(credentials);
    this.#credentials = credentials;
    this.#connection?.stop();
    this.#connection = null;
    this.#peers.clear();
    this.#pairing = null;
    this.#passkeys = credentials.relayUrl ? new RemotePasskeyService(credentials.relayUrl) : null;
    if (credentials.enabled) this.#startConnection();
    else {
      await this.#subscriptions.releaseOwner("remote");
      this.#projector.clearActiveThread();
      this.#coordinator.clear();
      this.#updateStatus({ enabled: false, phase: "disabled", message: "远程访问已关闭", relayUrl: credentials.relayUrl, pairing: null });
      this.#syncCredentialStatus();
    }
    return this.status;
  }

  async beginPairing(): Promise<RemoteAccessStatus> {
    this.#assertOwnership();
    const credentials = this.#credentials;
    if (!credentials?.enabled || !credentials.relayUrl || !this.#connection) throw new Error("请先填写中转服务地址并启用远程访问。");
    const material = RemoteCredentialStore.createPairingSecret();
    const pairingId = crypto.randomUUID();
    const expiresAt = Date.now() + 5 * 60_000;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.#pairing = { pairingId, ...material, code, expiresAt, readyToConfirm: false };
    this.#sendPolicy();
    const pairingPayload = Buffer.from(JSON.stringify({
      version: 1,
      relayOrigin: new URL(credentials.relayUrl).origin,
      channelId: credentials.channelId,
      pairingId,
      pairingSecret: material.secret,
      desktopSigningPublicKey: credentials.signingPublicKey,
      desktopAgreementPublicKey: credentials.agreementPublicKey,
      expiresAt
    })).toString("base64url");
    const pairingUrl = new URL(credentials.relayUrl);
    pairingUrl.pathname = "/";
    pairingUrl.search = "";
    pairingUrl.hash = new URLSearchParams({ pair: pairingPayload }).toString();
    this.#updatePairingStatus(pairingUrl.toString());
    return this.status;
  }

  async confirmPairing(pairingId: string): Promise<void> {
    this.#assertOwnership();
    const pairing = this.#pairing;
    if (!pairing || pairing.pairingId !== pairingId || pairing.expiresAt < Date.now()) throw new Error("配对请求已过期，请重新生成二维码。");
    if (!pairing.readyToConfirm || !pairing.peerId) throw new Error("请先在手机上创建 Passkey。");
    const peer = this.#peers.get(pairing.peerId);
    if (!peer?.secure || !peer.pendingDevice || !this.#credentials) throw new Error("手机配对连接已经断开，请重新生成二维码。");
    const devices = this.#credentials.devices.filter((device) => device.id !== peer.pendingDevice!.id && device.passkey.id !== peer.pendingDevice!.passkey.id);
    const updatedCredentials = { ...this.#credentials, devices: [...devices, peer.pendingDevice] };
    await this.#credentialStore.save(updatedCredentials);
    this.#credentials = updatedCredentials;
    await this.#auditLog.write("device.paired", { deviceId: peer.pendingDevice.id, deviceName: peer.pendingDevice.name }).catch(() => undefined);
    this.#sendSecure(peer, { type: "pairing.completed", deviceId: peer.pendingDevice.id });
    this.#pairing = null;
    this.#sendPolicy();
    this.#syncCredentialStatus();
    this.#updateStatus({ pairing: null, phase: "connected", message: "手机已绑定" });
  }

  async revokePasskey(credentialId: string): Promise<void> {
    this.#assertOwnership();
    if (!this.#credentials) return;
    const now = Date.now();
    const target = this.#credentials.devices.find((device) => device.passkey.id === credentialId && device.revokedAt === null);
    if (!target) return;
    const updatedCredentials = { ...this.#credentials, devices: this.#credentials.devices.map((device) => device.id === target.id ? { ...device, revokedAt: now } : device) };
    await this.#credentialStore.save(updatedCredentials);
    this.#credentials = updatedCredentials;
    await this.#auditLog.write("device.revoked", { deviceId: target.id, deviceName: target.name }).catch(() => undefined);
    for (const [peerId, peer] of this.#peers) if (peer.deviceId === target.id) this.#peers.delete(peerId);
    this.#sendPolicy();
    this.#syncCredentialStatus();
  }

  logoutAllMobiles(): void {
    this.#assertOwnership();
    this.#peers.clear();
    this.#connection?.reconnect();
    this.#updateStatus({ phase: "connecting", message: "已退出所有手机，正在重新连接…" });
  }

  acquireDesktopThread(threadId: string): void { this.#subscriptions.acquire(threadId, "desktop"); }
  releaseDesktopThread(threadId: string): Promise<boolean> { return this.#subscriptions.release(threadId, "desktop"); }
  handleDesktopResponse(id: string | number): void { this.#coordinator.remove(id); }
  updateSessionDefaults(defaults: { cwd: string | null; model: string | null }): void { this.#sessionDefaults = defaults; }

  async stop(): Promise<void> {
    if (this.#projectTimer) clearTimeout(this.#projectTimer);
    this.#projectTimer = null;
    this.#pendingProjected.clear();
    this.#peers.clear();
    this.#connection?.stop();
    this.#connection = null;
    this.#coordinator.clear();
    this.#subscriptions.clearOwner("remote");
  }

  handleConnectionState(state: ConnectionState): void {
    this.#projector.setConnection(state);
    if (this.#status.phase === "connected") this.#sendEvent({ type: "device.status", seq: this.#nextSeq(), online: true, codexState: this.#projector.snapshot().codexState, message: state.message });
  }

  handleProtocolEvent(event: ProtocolEvent): void {
    if (!this.#ownsRemoteAccess || !this.#credentials?.enabled) return;
    if (event.kind === "server-request") {
      const envelope = record(event.payload);
      const id = envelope.id;
      if (typeof id !== "string" && typeof id !== "number") return;
      const params = record(envelope.params);
      const approval = this.#coordinator.observe(event.generation, id, text(envelope.method), params);
      if (!approval) {
        this.#sendEvent({ type: "desktop.required", seq: this.#nextSeq(), message: "有一项操作需要在桌面端处理。" });
        return;
      }
      const summary = sanitizeRemoteActivityText(text(params.reason) || text(params.command) || text(params.message) || text(params.url) || text(params.toolName) || "Codex 请求执行一项操作", text(params.cwd), 4_000);
      this.#sendEvent({
        type: "approval.request",
        seq: this.#nextSeq(),
        threadId: approval.threadId || this.#projector.activeThreadId || "unknown",
        approval: { id: String(id), kind: "approval", title: text(envelope.method).includes("mcp") ? "MCP 操作确认" : "命令执行确认", summary, version: approval.version, decisions: ["accept", "decline"] }
      });
      return;
    }
    const projected = this.#projector.applyProtocolEvent(event);
    const envelope = record(event.payload);
    const method = text(envelope.method);
    if (projected) {
      const key = `${projected.threadId}:${projected.item.id}`;
      if (method === "item/agentMessage/delta") this.#queueProjected(key, projected);
      else {
        this.#pendingProjected.delete(key);
        this.#sendEvent({ type: "item.upsert", seq: this.#nextSeq(), ...projected });
      }
    }
    if (method === "turn/started" || method === "turn/completed") {
      const threadId = text(record(envelope.params).threadId);
      if (threadId) this.#sendEvent({ type: "turn.status", seq: this.#nextSeq(), threadId, status: this.#projector.snapshot().turnStatus });
    }
    if (method === "serverRequest/resolved") {
      const id = record(envelope.params).requestId;
      if (typeof id === "string" || typeof id === "number") this.#coordinator.remove(id);
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() });
    }
  }

  #startConnection(): void {
    const credentials = this.#credentials;
    if (!credentials?.enabled || !credentials.relayUrl) return;
    this.#passkeys = new RemotePasskeyService(credentials.relayUrl);
    const connection = new RelayConnection(credentials, () => this.#credentialStore.revealSigningPrivateKey(credentials));
    this.#connection = connection;
    connection.on("event", (event: RelayConnectionEvent) => { void this.#handleRelayEvent(event); });
    this.#updateStatus({ enabled: true, phase: "connecting", message: "正在连接中转服务…", relayUrl: credentials.relayUrl });
    this.#syncCredentialStatus();
    connection.start();
  }

  async #handleRelayEvent(event: RelayConnectionEvent): Promise<void> {
    if (event.type === "state") {
      this.#updateStatus({ phase: event.phase, message: event.message });
      return;
    }
    if (event.type === "attached") {
      this.#peers.clear();
      this.#sendPolicy();
      this.#updateStatus({ phase: this.#pairing ? "pairing" : "connected", message: this.#pairing ? "等待手机完成绑定" : "已连接中转服务" });
      return;
    }
    if (event.type === "peerOnline") {
      this.#peers.set(event.peerId, { peerId: event.peerId, mode: event.mode, deviceId: event.deviceId, dataQueue: new SerialTaskQueue(), authenticated: false });
      return;
    }
    if (event.type === "peerOffline") {
      this.#peers.delete(event.peerId);
      if (this.#pairing?.peerId === event.peerId && !this.#pairing.readyToConfirm) this.#updateStatus({ message: "手机连接已断开，请重新扫码" });
      return;
    }
    if (event.type === "data") {
      const peer = this.#peers.get(event.peerId);
      if (!peer) return;
      await peer.dataQueue.enqueue(async () => {
        if (this.#peers.get(event.peerId) !== peer) return;
        await this.#handlePeerData(event.peerId, event.payload);
      });
    }
  }

  async #handlePeerData(peerId: string, raw: string): Promise<void> {
    const peer = this.#peers.get(peerId);
    if (!peer) return;
    try {
      const payload = peerPayloadSchema.parse(JSON.parse(raw));
      if (payload.type === "pairing.hello") {
        await this.#handlePairingHello(peer, payload);
        return;
      }
      if (payload.type === "session.hello") {
        await this.#handleSessionHello(peer, payload);
        return;
      }
      if (payload.type !== "secure" || !peer.secure) throw new Error("尚未建立安全连接。");
      await this.#handleSecurePayload(peer, peer.secure.decrypt(payload));
    } catch (error) {
      await this.#auditLog.write("peer.rejected", { deviceId: peer.deviceId ?? null, reason: error instanceof Error ? error.message.slice(0, 500) : "远程消息无效" }).catch(() => undefined);
      if (peer.secure) {
        try { this.#sendSecure(peer, { type: "error", message: error instanceof Error ? error.message : "远程消息无效。" }); }
        catch { /* The peer may have disconnected while the request was being processed. */ }
      }
    }
  }

  async #handlePairingHello(peer: PeerState, raw: unknown): Promise<void> {
    const hello = pairingHelloSchema.parse(raw);
    const pairing = this.#pairing;
    const credentials = this.#credentials;
    if (peer.mode !== "pairing" || !pairing || !credentials || hello.pairingId !== pairing.pairingId || pairing.expiresAt < Date.now()) throw new Error("配对请求已过期。");
    const context = `pairing\n${credentials.channelId}\n${pairing.pairingId}\n${hello.sessionId}`;
    const key = deriveSessionKey(this.#credentialStore.revealAgreementPrivateKey(credentials), hello.mobileAgreementPublicKey, context);
    peer.secure = new SecureSession(hello.sessionId, key);
    const start = pairingStartSchema.parse(peer.secure.decrypt(hello.envelope));
    if (start.pairingSecret !== pairing.secret) throw new Error("配对信息不正确。");
    const options = await this.#passkeys!.registrationOptions(start.deviceId, credentials.devices);
    peer.registrationChallenge = options.challenge;
    peer.pendingDevice = {
      id: start.deviceId,
      name: start.deviceName,
      signingPublicKey: start.signingPublicKey,
      agreementPublicKey: start.agreementPublicKey,
      passkey: { id: "pending", publicKey: "pending", counter: 0, transports: [], name: start.deviceName, createdAt: Date.now(), lastUsedAt: null },
      createdAt: Date.now(),
      revokedAt: null
    };
    pairing.peerId = peer.peerId;
    this.#sendSecure(peer, { type: "passkey.registration.options", options, code: pairing.code });
  }

  async #handleSessionHello(peer: PeerState, raw: unknown): Promise<void> {
    const hello = z.object({
      type: z.literal("session.hello"), sessionId: z.string().uuid(), deviceId: z.string().uuid(),
      mobileEphemeralPublicKey: z.object({ kty: z.string(), crv: z.string(), x: z.string(), y: z.string() }).passthrough(),
      timestamp: z.number().int().positive(), signature: z.string()
    }).parse(raw);
    const credentials = this.#credentials;
    const device = credentials?.devices.find((candidate) => candidate.id === hello.deviceId && candidate.revokedAt === null);
    if (peer.mode !== "device" || peer.deviceId !== hello.deviceId || !credentials || !device || Math.abs(Date.now() - hello.timestamp) > 30_000) throw new Error("设备未获准访问。");
    const proof = sessionHelloProof(credentials.channelId, hello.sessionId, hello.deviceId, hello.mobileEphemeralPublicKey, hello.timestamp);
    if (!verifyP256(device.signingPublicKey, proof, hello.signature)) throw new Error("设备身份验证失败。");
    peer.authenticated = false;
    peer.authenticationChallenge = undefined;
    const ephemeral = generateP256KeyPair();
    const context = `session\n${credentials.channelId}\n${hello.sessionId}\n${hello.deviceId}`;
    peer.secure = new SecureSession(hello.sessionId, deriveSessionKey(ephemeral.privateKey, hello.mobileEphemeralPublicKey, context));
    const timestamp = Date.now();
    const welcomeProof = sessionWelcomeProof(credentials.channelId, hello.sessionId, hello.mobileEphemeralPublicKey, ephemeral.publicKey, timestamp);
    this.#connection?.send(peer.peerId, { type: "session.welcome", sessionId: hello.sessionId, desktopEphemeralPublicKey: ephemeral.publicKey, timestamp, signature: signP256(this.#credentialStore.revealSigningPrivateKey(credentials), welcomeProof) });
    const options = await this.#passkeys!.authenticationOptions(device);
    peer.authenticationChallenge = options.challenge;
    this.#sendSecure(peer, { type: "passkey.authentication.options", options });
  }

  async #handleSecurePayload(peer: PeerState, raw: unknown): Promise<void> {
    const payload = record(raw);
    if (payload.type === "passkey.registration.response") {
      if (!peer.registrationChallenge || !peer.pendingDevice || !this.#pairing) throw new Error("Passkey 登记已经过期。");
      const passkey = await this.#passkeys!.verifyRegistration(peer.registrationChallenge, payload.response as RegistrationResponseJSON, text(payload.name) || peer.pendingDevice.name);
      peer.registrationChallenge = undefined;
      peer.pendingDevice = { ...peer.pendingDevice, passkey };
      this.#pairing.readyToConfirm = true;
      this.#pairing.peerId = peer.peerId;
      this.#sendSecure(peer, { type: "pairing.awaiting-confirmation", code: this.#pairing.code });
      this.#updatePairingStatus();
      this.#updateStatus({ message: "手机已登记，请核对确认码" });
      return;
    }
    if (payload.type === "passkey.authentication.response") {
      const credentials = this.#credentials;
      const device = credentials?.devices.find((candidate) => candidate.id === peer.deviceId && candidate.revokedAt === null);
      if (!device || !peer.authenticationChallenge || !credentials) throw new Error("登录请求已经过期。");
      const counter = await this.#passkeys!.verifyAuthentication(peer.authenticationChallenge, payload.response as AuthenticationResponseJSON, device);
      peer.authenticationChallenge = undefined;
      const authenticatedAt = Date.now();
      const updatedCredentials = {
        ...credentials,
        devices: credentials.devices.map((candidate) => candidate.id === device.id ? {
          ...candidate,
          passkey: { ...candidate.passkey, counter, lastUsedAt: authenticatedAt }
        } : candidate)
      };
      await this.#credentialStore.save(updatedCredentials);
      this.#credentials = updatedCredentials;
      peer.authenticated = true;
      await this.#auditLog.write("passkey.authenticated", { deviceId: device.id, deviceName: device.name }).catch(() => undefined);
      this.#syncCredentialStatus();
      this.#sendSecure(peer, { type: "session.ready" });
      await this.#sendMobileDocument(peer);
      await this.#refreshThreads();
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() }, peer.peerId);
      return;
    }
    if (payload.type === "mobile.command") {
      if (!peer.authenticated) throw new Error("请先使用 Passkey 登录。");
      await this.#handleCommand(peer, payload.command);
      return;
    }
    if (payload.type === "ui.ready" && peer.authenticated) {
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() }, peer.peerId);
      return;
    }
    throw new Error("手机请求不受支持。");
  }

  async #handleCommand(peer: PeerState, raw: unknown): Promise<void> {
    let command: MobileCommand;
    let requestId = "";
    try {
      command = mobileCommandSchema.parse(raw);
      requestId = command.requestId;
      const cached = this.#requestResults.get(requestId);
      if (cached && Date.now() - cached.at < 10 * 60_000) {
        this.#sendEvent(cached.event, peer.peerId);
        return;
      }
      await this.#execute(command);
      this.#rememberResult(requestId, true, "操作已完成", peer.peerId);
    } catch (error) {
      if (requestId) this.#rememberResult(requestId, false, error instanceof Error ? error.message : String(error), peer.peerId);
    }
  }

  async #execute(command: MobileCommand): Promise<void> {
    if (command.type === "snapshot.get") {
      await this.#refreshThreads();
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() });
      return;
    }
    if (command.type === "thread.list") {
      const threads = await this.#refreshThreads();
      for (const thread of threads) this.#sendEvent({ type: "thread.summary", seq: this.#nextSeq(), thread });
      return;
    }
    if (command.type === "thread.open") {
      const previous = this.#projector.activeThreadId;
      const response = record(await this.#supervisor.call("thread/resume", { threadId: command.threadId, excludeTurns: false, initialTurnsPage: { limit: 100, sortDirection: "desc", itemsView: "full" } }));
      if (previous && previous !== command.threadId) await this.#subscriptions.release(previous, "remote");
      this.#subscriptions.acquire(command.threadId, "remote");
      const thread = record(response.thread);
      const historyPage = record(response.initialTurnsPage);
      const history = Array.isArray(historyPage.data) ? [...historyPage.data].reverse() : thread.turns;
      this.#projector.setActiveThread({ ...thread, cwd: text(response.cwd) || text(thread.cwd), turns: history });
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() });
      return;
    }
    if (command.type === "thread.new") {
      const previous = this.#projector.activeThreadId;
      const response = record(await this.#supervisor.call("thread/start", { cwd: this.#sessionDefaults.cwd, model: this.#sessionDefaults.model, ephemeral: false }));
      const thread = record(response.thread);
      const threadId = text(thread.id);
      if (!threadId) throw new Error("Codex 未返回新会话标识。");
      if (previous && previous !== threadId) await this.#subscriptions.release(previous, "remote");
      this.#subscriptions.acquire(threadId, "remote");
      this.#projector.setActiveThread({ ...thread, cwd: text(thread.cwd) || this.#sessionDefaults.cwd || "" });
      await this.#refreshThreads();
      this.#sendEvent({ type: "snapshot", seq: this.#nextSeq(), snapshot: this.#projector.snapshot() });
      return;
    }
    if (command.type === "turn.send") {
      const threadId = this.#projector.activeThreadId;
      if (!threadId) throw new Error("请先选择或新建会话。");
      const input = [{ type: "text", text: command.text, text_elements: [] }];
      if (this.#projector.activeTurnId) await this.#supervisor.call("turn/steer", { threadId, expectedTurnId: this.#projector.activeTurnId, clientUserMessageId: crypto.randomUUID(), input });
      else {
        const response = record(await this.#supervisor.call("turn/start", { threadId, clientUserMessageId: crypto.randomUUID(), input, model: null, effort: null }));
        this.#projector.setActiveTurn(text(record(response.turn).id));
      }
      return;
    }
    this.#coordinator.resolve(command.approvalId, command.version, command.decision);
    await this.#auditLog.write("approval.resolved", { approvalId: command.approvalId, decision: command.decision }).catch(() => undefined);
  }

  async #refreshThreads() {
    const response = record(await this.#supervisor.call("thread/list", { limit: 100, sortKey: "updated_at", sortDirection: "desc", searchTerm: null, cwd: null }));
    return this.#projector.setThreads(Array.isArray(response.data) ? response.data : []);
  }

  #rememberResult(requestId: string, ok: boolean, message: string, peerId: string): void {
    const event: DesktopEvent = { type: "command.result", seq: this.#nextSeq(), requestId, ok, message: message.slice(0, 2_000) };
    this.#requestResults.set(requestId, { at: Date.now(), event });
    for (const [id, result] of this.#requestResults) if (Date.now() - result.at > 10 * 60_000) this.#requestResults.delete(id);
    while (this.#requestResults.size > 1_000) this.#requestResults.delete(this.#requestResults.keys().next().value!);
    this.#sendEvent(event, peerId);
  }

  #sendEvent(event: DesktopEvent, peerId?: string): void {
    const peers = peerId ? [this.#peers.get(peerId)].filter((peer): peer is PeerState => Boolean(peer)) : [...this.#peers.values()];
    for (const peer of peers) if (peer.authenticated && peer.secure) this.#sendSecure(peer, { type: "desktop.event", event });
  }

  #sendSecure(peer: PeerState, payload: unknown): void {
    if (!peer.secure) throw new Error("安全连接尚未建立。");
    this.#connection?.send(peer.peerId, peer.secure.encrypt(payload));
  }

  async #sendMobileDocument(peer: PeerState): Promise<void> {
    if (this.#mobileDocument === null) {
      const path = join(app.getAppPath(), "remote", "mobile", "dist-bundle", "mobile.html");
      this.#mobileDocument = await readFile(path, "utf8");
      if (Buffer.byteLength(this.#mobileDocument) > MAX_MOBILE_DOCUMENT_BYTES) throw new Error("手机页面资源超过大小限制。");
    }
    const version = app.getVersion();
    const hash = createHash("sha256").update(this.#mobileDocument).digest("base64url");
    const signature = signP256(this.#credentialStore.revealSigningPrivateKey(this.#credentials!), uiDocumentProof(version, hash));
    this.#sendSecure(peer, { type: "ui.document", version, hash, signature, html: this.#mobileDocument });
  }

  #sendPolicy(): void {
    if (!this.#connection || !this.#credentials) return;
    const devices = this.#credentials.devices.filter((device) => device.revokedAt === null).map((device) => ({ deviceId: device.id, publicKey: device.signingPublicKey }));
    const pairing = this.#pairing && this.#pairing.expiresAt > Date.now() ? { pairingId: this.#pairing.pairingId, secretHash: this.#pairing.hash, expiresAt: this.#pairing.expiresAt } : null;
    try { this.#connection.sendPolicy({ revision: ++this.#policyRevision, devices, pairing }); } catch { /* The policy is resent after reconnect. */ }
  }

  #updatePairingStatus(url?: string): void {
    const pairing = this.#pairing;
    if (!pairing) return;
    const previousUrl = this.#status.pairing?.url;
    const info: RemotePairingInfo = { pairingId: pairing.pairingId, url: url ?? previousUrl ?? "", code: pairing.code, expiresAt: pairing.expiresAt, readyToConfirm: pairing.readyToConfirm };
    this.#updateStatus({ pairing: info, phase: "pairing", message: pairing.readyToConfirm ? "手机已登记，请核对确认码" : "请使用手机扫描配对二维码" });
  }

  #syncCredentialStatus(): void {
    const active = this.#credentials?.devices.filter((device) => device.revokedAt === null) ?? [];
    this.#updateStatus({
      relayUrl: this.#credentials?.relayUrl ?? "",
      paired: active.length > 0,
      passkeys: active.map((device) => {
        const fingerprint = device.id.slice(0, 6).toUpperCase();
        const name = device.name.endsWith(`· ${fingerprint}`) ? device.name : `${device.name} · ${fingerprint}`;
        return { id: device.passkey.id, name, createdAt: device.createdAt, lastUsedAt: device.passkey.lastUsedAt };
      })
    });
  }

  #assertOwnership(): void {
    if (!this.#ownsRemoteAccess) throw new Error("远程访问正由另一个应用实例管理。关闭另一个实例后，请重启本窗口接管。");
  }

  #showStandbyStatus(): void {
    this.#syncCredentialStatus();
    this.#updateStatus({
      enabled: this.#credentials?.enabled ?? false,
      phase: "standby",
      message: "由另一个实例管理",
      pairing: null
    });
  }

  #queueProjected(key: string, projected: { threadId: string; item: MobileItem }): void {
    this.#pendingProjected.set(key, projected);
    if (this.#projectTimer) return;
    this.#projectTimer = setTimeout(() => {
      this.#projectTimer = null;
      const events = [...this.#pendingProjected.values()];
      this.#pendingProjected.clear();
      for (const event of events) this.#sendEvent({ type: "item.upsert", seq: this.#nextSeq(), ...event });
    }, 50);
  }

  #nextSeq(): number { return ++this.#seq; }

  #updateStatus(patch: Partial<RemoteAccessStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.emit("status", this.status);
  }
}
