import { computed, markRaw, ref, shallowReactive, watch } from "vue";
import { defineStore } from "pinia";
import type { ConnectionState, ProtocolEvent } from "../../electron/shared/contracts";
import type { AppearanceSettings, AppState, ApprovalReviewState, BackgroundTerminalState, LayoutKind, McpServerState, ModelOption, PaneState, PendingServerRequest, SubAgentRuntimeState, ThreadSummary, UiItem, UiItemStatus } from "../types";

const DEFAULT_CONNECTION: ConnectionState = {
  phase: "stopped",
  generation: 0,
  codexVersion: null,
  compatible: null,
  message: "正在启动…"
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "dark",
  fontFamily: '"Segoe UI", "Microsoft YaHei UI", sans-serif',
  fontSize: 14,
  accentColor: "#10a37f",
  commandShellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  mcpGatewayAdaptation: false
};
const HISTORY_TURN_PAGE_SIZE = 12;
const LAYOUT_PANE_COUNTS: Record<LayoutKind, number> = { single: 1, vertical: 2, horizontal: 2, quad: 4, fourColumns: 4, fourRows: 4, six: 6 };

const createPane = (index: number): PaneState => ({
  id: `pane-${index + 1}`,
  title: "新会话",
  threadId: null,
  cwd: "",
  draft: "",
  attachments: [],
  references: [],
  skills: [],
  activePermissionProfile: null,
  model: null,
  effort: null,
  activeTurnId: null,
  status: "idle",
  items: [],
  tokenUsage: null,
  contextRemainingPercent: null,
  turnDiff: "",
  activeFlags: [],
  approvalReviews: [],
  strictReviewRequired: false,
  backgroundTerminals: [],
  subAgents: {},
  error: null,
  unread: false,
  scrollTop: 0,
  followTail: true,
  historyCursor: null,
  historyLoading: false
});

const getRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const getString = (value: unknown): string | null => typeof value === "string" ? value : null;
const formatAuthMode = (mode: string | null): string | null => {
  if (!mode) return null;
  if (["apikey", "apiKey", "headers", "agentIdentity", "personalAccessToken", "bedrockApiKey"].includes(mode)) return "API 模式";
  if (mode === "chatgpt" || mode === "chatgptAuthTokens") return "ChatGPT 订阅";
  return mode;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const state = ref<AppState>({
    connection: DEFAULT_CONNECTION,
    layout: "single",
    splitSizes: {},
    defaultCwd: "",
    focusedPaneId: null,
    panes: Array.from({ length: 6 }, (_, index) => createPane(index)),
    pendingRequests: [],
    models: [],
    accountLabel: "—",
    rateLimits: null,
    rateLimitLabels: [],
    accountUsage: null,
    mcpServers: [],
    appearance: { ...DEFAULT_APPEARANCE },
    effectiveConfig: null,
    permissionProfiles: [],
    threads: [],
    notices: [],
    initialized: false
  });
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const paneReadiness = new Map<string, Promise<void>>();
  const threadCreations = new Map<string, Promise<string>>();
  const sendsInFlight = new Set<string>();
  const responsesInFlight = new Set<string>();
  const deltaBuffers = new Map<string, { item: UiItem; text: string }>();
  let deltaFlushFrame: number | null = null;
  const paneItemIndexes = new Map<string, Map<string, UiItem>>();
  const historyRequestTokens = new Map<string, symbol>();
  let preparedGeneration = -1;
  let threadListRequestId = 0;

  const itemKey = (turnId: string, itemId: string): string => `${turnId}:${itemId}`;
  const createUiItem = (value: UiItem): UiItem => shallowReactive({ ...value, data: markRaw(value.data) });
  const indexPaneItems = (pane: PaneState): void => {
    paneItemIndexes.set(pane.id, new Map(pane.items.map((item) => [itemKey(item.turnId, item.id), item])));
  };
  const findPaneItem = (pane: PaneState, itemId: string, turnId: string): UiItem | undefined => {
    let index = paneItemIndexes.get(pane.id);
    if (!index) {
      indexPaneItems(pane);
      index = paneItemIndexes.get(pane.id)!;
    }
    return index.get(itemKey(turnId, itemId));
  };
  const appendPaneItem = (pane: PaneState, item: UiItem): UiItem => {
    const reactiveItem = createUiItem(item);
    pane.items.push(reactiveItem);
    let index = paneItemIndexes.get(pane.id);
    if (!index) {
      index = new Map();
      paneItemIndexes.set(pane.id, index);
    }
    index.set(itemKey(reactiveItem.turnId, reactiveItem.id), reactiveItem);
    return reactiveItem;
  };
  const discardPaneDeltas = (paneId: string): void => {
    for (const key of deltaBuffers.keys()) {
      if (key.startsWith(`${paneId}:`)) deltaBuffers.delete(key);
    }
    if (!deltaBuffers.size && deltaFlushFrame !== null) {
      window.cancelAnimationFrame(deltaFlushFrame);
      deltaFlushFrame = null;
    }
  };
  const discardAllDeltas = (): void => {
    deltaBuffers.clear();
    if (deltaFlushFrame !== null) window.cancelAnimationFrame(deltaFlushFrame);
    deltaFlushFrame = null;
  };

  const visiblePaneCount = computed(() => LAYOUT_PANE_COUNTS[state.value.layout]);
  const visiblePanes = computed(() => {
    const panes = state.value.panes.slice(0, visiblePaneCount.value);
    if (state.value.focusedPaneId) {
      return panes.filter((pane) => pane.id === state.value.focusedPaneId);
    }
    return panes;
  });
  const pendingCount = computed(() => state.value.pendingRequests.length);

  const initialize = async (): Promise<void> => {
    let bootstrapping = true;
    let bufferedConnection: ConnectionState | null = null;
    const bufferedProtocolEvents: ProtocolEvent[] = [];
    const removeStateListener = window.codexPane.onConnectionState((connection) => {
      if (bootstrapping) bufferedConnection = connection;
      else handleConnectionState(connection);
    });
    const removeProtocolListener = window.codexPane.onProtocolEvent((event) => {
      if (bootstrapping) bufferedProtocolEvents.push(event);
      else handleProtocolEvent(event);
    });
    window.addEventListener("beforeunload", () => {
      removeStateListener();
      removeProtocolListener();
    }, { once: true });
    const bootstrap = await window.codexPane.bootstrap();
    state.value.connection = bufferedConnection ?? bootstrap.connection;
    if (bootstrap.workspace) {
      state.value.layout = bootstrap.workspace.layout;
      state.value.splitSizes = bootstrap.workspace.splitSizes;
      state.value.defaultCwd = bootstrap.workspace.defaultCwd;
      state.value.appearance = { ...DEFAULT_APPEARANCE, ...bootstrap.workspace.appearance };
      state.value.focusedPaneId = bootstrap.workspace.focusedPaneId;
      state.value.panes = bootstrap.workspace.panes.map((pane, index) => ({
        ...createPane(index),
        ...pane,
        title: "新会话",
        activeTurnId: null,
        status: "idle",
        items: [],
        tokenUsage: null,
        contextRemainingPercent: null,
        turnDiff: "",
        activeFlags: [],
        approvalReviews: [],
        strictReviewRequired: false,
        backgroundTerminals: [],
        subAgents: {},
        error: null,
        unread: false,
        historyCursor: null,
        historyLoading: false
      }));
      while (state.value.panes.length < 6) {
        state.value.panes.push(createPane(state.value.panes.length));
      }
      const boundThreads = new Map<string, string>();
      for (const pane of state.value.panes) {
        if (!pane.threadId) continue;
        const owner = boundThreads.get(pane.threadId);
        if (owner) {
          pane.threadId = null;
          pane.error = `原会话已由${owner}打开，本窗格已切换为新会话。`;
          continue;
        }
        boundThreads.set(pane.threadId, pane.title);
      }
    }
    if (bootstrap.workspaceWarning) addNotice(bootstrap.workspaceWarning);
    bootstrapping = false;
    state.value.initialized = true;
    for (const event of bufferedProtocolEvents) handleProtocolEvent(event);
    if (state.value.connection.phase === "ready") {
      await prepareConnection(state.value.connection.generation);
    }
  };

  const handleConnectionState = (connection: ConnectionState): void => {
    const generationChanged = state.value.connection.generation !== connection.generation;
    const becameReady = state.value.connection.phase !== "ready" && connection.phase === "ready";
    state.value.connection = connection;
    if (generationChanged) {
      state.value.pendingRequests = state.value.pendingRequests.filter((request) => request.generation === connection.generation);
      discardAllDeltas();
    }
    if (becameReady) {
      void prepareConnection(connection.generation);
    }
    if (connection.phase === "error" || connection.phase === "restarting") {
      for (const pane of state.value.panes) {
        pane.activeTurnId = null;
        if (pane.status !== "idle") {
          pane.status = "error";
          pane.error = connection.message;
        }
      }
      state.value.pendingRequests = [];
    }
  };

  const prepareConnection = async (generation: number): Promise<void> => {
    if (preparedGeneration === generation) return;
    preparedGeneration = generation;
    await Promise.all([probeCapabilities(), resumeBoundThreads()]);
  };

  const handleProtocolEvent = (event: ProtocolEvent): void => {
    if (event.kind === "notification-batch") {
      if (Array.isArray(event.payload)) {
        for (const nested of event.payload) handleProtocolEvent(nested as ProtocolEvent);
      }
      return;
    }
    if (event.generation !== state.value.connection.generation) return;
    if (event.kind === "server-request") {
      addServerRequest(event);
      return;
    }
    if (event.kind !== "notification") {
      return;
    }
    const envelope = getRecord(event.payload);
    const method = getString(envelope.method);
    const params = getRecord(envelope.params);
    if (!method) {
      return;
    }
    if (method === "serverRequest/resolved") {
      const requestId = params.requestId;
      state.value.pendingRequests = state.value.pendingRequests.filter((request) => request.generation !== event.generation || typeof request.id !== typeof requestId || request.id !== requestId);
      return;
    }
    if (method === "account/updated") {
      state.value.accountLabel = formatAuthMode(getString(params.authMode)) ?? "未登录";
      return;
    }
    if (method === "account/rateLimits/updated") {
      mergeRateLimitUpdate(getRecord(params.rateLimits));
      return;
    }
    if (method === "thread/name/updated") {
      const threadId = getString(params.threadId);
      const pane = state.value.panes.find((candidate) => candidate.threadId === threadId);
      if (pane) pane.title = getString(params.threadName) || defaultPaneTitle(pane);
      const thread = state.value.threads.find((candidate) => candidate.id === threadId);
      if (thread) thread.name = getString(params.threadName);
      scheduleSave();
      return;
    }
    if (method === "mcpServer/startupStatus/updated") {
      mergeMcpStartupStatus(params);
      if (getString(params.status) === "failed") {
        const recovery = getString(params.failureReason) === "reauthenticationRequired" ? "请重新登录该 MCP 服务" : "请检查配置后重试";
        addNotice(`MCP 服务 ${getString(params.name) ?? "未知"} 启动失败：${getString(params.error) ?? recovery}`);
      }
    }
    if (method === "mcpServer/oauthLogin/completed") {
      const name = getString(params.name) ?? "未知";
      if (params.success === true) {
        addNotice(`MCP 服务 ${name} 已完成登录。`);
        void refreshMcpServers(getString(params.threadId));
      } else {
        addNotice(`MCP 服务 ${name} 登录失败：${getString(params.error) ?? "请重试"}`);
      }
      if (!getString(params.threadId)) return;
    }
    if ((method === "warning" || method === "configWarning") && !getString(params.threadId)) {
      addNotice(getString(params.message) ?? "Codex 返回了一条警告");
    }
    if (method === "account/login/completed" && params.success === false) {
      addNotice(`登录未完成：${getString(params.error) ?? "请重试"}`);
    }
    const pane = findPaneForParams(params);
    if (!pane) {
      return;
    }
    const activePaneId = document.activeElement instanceof Element ? document.activeElement.closest("[data-pane-id]")?.getAttribute("data-pane-id") : null;
    pane.unread = document.hidden || activePaneId !== pane.id;
    reducePaneNotification(pane, method, params);
  };

  const reducePaneNotification = (pane: PaneState, method: string, params: Record<string, unknown>): void => {
    if (method === "thread/status/changed") {
      const statusRecord = getRecord(params.status);
      const status = getString(statusRecord.type) ?? getString(params.status);
      pane.activeFlags = Array.isArray(statusRecord.activeFlags)
        ? statusRecord.activeFlags.filter((flag): flag is "waitingOnApproval" | "waitingOnUserInput" => flag === "waitingOnApproval" || flag === "waitingOnUserInput")
        : [];
      if (status === "active") {
        pane.status = "running";
      } else if (status === "idle") {
        pane.activeTurnId = null;
        pane.status = "idle";
        pane.strictReviewRequired = false;
      } else if (status === "systemError") {
        pane.status = "error";
        pane.error ??= "Codex 会话发生系统错误，请重新连接后重试。";
      } else if (status === "notLoaded" && pane.status !== "starting") {
        pane.activeTurnId = null;
        pane.status = "idle";
      }
      return;
    }
    if (method === "thread/settings/updated") {
      const settings = getRecord(params.threadSettings);
      pane.cwd = getString(settings.cwd) ?? pane.cwd;
      pane.model = getString(settings.model) ?? pane.model;
      if (Object.hasOwn(settings, "effort")) pane.effort = getString(settings.effort);
      pane.activePermissionProfile = getString(getRecord(settings.activePermissionProfile).id) ?? pane.activePermissionProfile;
      scheduleSave();
      return;
    }
    if (method === "turn/started") {
      const turn = getRecord(params.turn);
      pane.activeTurnId = getString(turn.id);
      pane.status = "running";
      pane.error = null;
      return;
    }
    if (method === "turn/completed") {
      const turn = getRecord(params.turn);
      const completedItems = Array.isArray(turn.items) ? turn.items : [];
      for (const item of completedItems) mergeItem(pane, { turnId: getString(turn.id), item }, true);
      if (!pane.activeTurnId || pane.activeTurnId === getString(turn.id)) {
        pane.activeTurnId = null;
        pane.status = getString(turn.status) === "failed" ? "error" : "idle";
        pane.error = getString(getRecord(turn.error).message);
      }
      pane.strictReviewRequired = false;
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = getRecord(params.tokenUsage);
      pane.tokenUsage = usage;
      pane.contextRemainingPercent = calculateContextRemainingPercent(usage);
      return;
    }
    if (method === "turn/diff/updated") {
      pane.turnDiff = getString(params.diff) ?? "";
      return;
    }
    if (method === "item/autoApprovalReview/started" || method === "item/autoApprovalReview/completed") {
      mergeApprovalReview(pane, params, method.endsWith("completed"));
      return;
    }
    if (method === "autoApprovalReview/strictReviewRequired") {
      pane.strictReviewRequired = true;
      return;
    }
    if (method === "item/fileChange/patchUpdated") {
      mergeFileChangePatch(pane, params);
      return;
    }
    if (method === "item/mcpToolCall/progress") {
      mergeMcpProgress(pane, params);
      return;
    }
    if (method === "error") {
      if (!params.willRetry) {
        pane.error = getString(getRecord(params.error).message) ?? getString(params.message) ?? "Codex 运行时发生错误";
      }
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      mergeItem(pane, params, method === "item/completed");
      return;
    }
    if (method.includes("/delta") || method.endsWith("outputDelta")) {
      mergeDelta(pane, params);
    }
  };

  const mergeItem = (pane: PaneState, params: Record<string, unknown>, completed: boolean): void => {
    const item = getRecord(params.item);
    const itemId = getString(item.id);
    const turnId = getString(params.turnId) ?? pane.activeTurnId ?? "unknown-turn";
    if (!itemId) {
      return;
    }
    flushDelta(`${pane.id}:${turnId}:${itemId}`);
    const clientId = getString(item.clientId);
    const existing = findPaneItem(pane, itemId, turnId) ?? (clientId
      ? pane.items.find((candidate) => candidate.type === "userMessage" && getString(candidate.data.clientId) === clientId)
      : undefined);
    if (existing) {
      const previousKey = itemKey(existing.turnId, existing.id);
      existing.id = itemId;
      existing.turnId = turnId;
      existing.data = markRaw(item);
      existing.type = getString(item.type) ?? existing.type;
      existing.status = resolveItemStatus(item, completed);
      if (completed && existing.type === "reasoning" && !hasReasoningContent(existing)) {
        pane.items = pane.items.filter((candidate) => candidate !== existing);
        paneItemIndexes.get(pane.id)?.delete(previousKey);
      } else {
        const index = paneItemIndexes.get(pane.id);
        index?.delete(previousKey);
        index?.set(itemKey(existing.turnId, existing.id), existing);
      }
      syncSubAgentState(pane, existing);
      return;
    }
    if (completed && getString(item.type) === "reasoning" && !hasReasoningContent({ id: itemId, turnId, type: "reasoning", data: item, streamText: "", status: "completed" })) return;
    const nextItem: UiItem = {
      id: itemId,
      turnId,
      type: getString(item.type) ?? "unknown",
      data: item,
      streamText: "",
      status: resolveItemStatus(item, completed)
    };
    const appendedItem = appendPaneItem(pane, nextItem);
    syncSubAgentState(pane, appendedItem);
  };

  const resolveItemStatus = (item: Record<string, unknown>, completed: boolean): UiItemStatus => {
    const status = getString(item.status);
    if (status === "inProgress") return "running";
    if (status === "failed" || status === "declined" || status === "completed") return status;
    return completed ? "completed" : "running";
  };

  const hasReasoningContent = (item: UiItem): boolean => {
    const summary = Array.isArray(item.data.summary) ? item.data.summary : [];
    const content = Array.isArray(item.data.content) ? item.data.content : [];
    return [...summary, ...content].some((part) => typeof part === "string" && part.trim()) || Boolean(item.streamText.trim());
  };

  const calculateContextRemainingPercent = (usage: Record<string, unknown>): number | null => {
    const contextWindow = typeof usage.modelContextWindow === "number" ? usage.modelContextWindow : null;
    const usedTokens = getRecord(usage.last).totalTokens;
    if (!contextWindow || contextWindow <= 12_000 || typeof usedTokens !== "number") return null;
    const effectiveWindow = contextWindow - 12_000;
    const used = Math.max(0, usedTokens - 12_000);
    return Math.round(Math.max(0, Math.min(1, (effectiveWindow - used) / effectiveWindow)) * 100);
  };

  const mergeApprovalReview = (pane: PaneState, params: Record<string, unknown>, completed: boolean): void => {
    const reviewId = getString(params.reviewId);
    if (!reviewId) return;
    const review = getRecord(params.review);
    const next: ApprovalReviewState = {
      reviewId,
      turnId: getString(params.turnId) ?? "unknown-turn",
      targetItemId: getString(params.targetItemId),
      startedAtMs: typeof params.startedAtMs === "number" ? params.startedAtMs : Date.now(),
      completedAtMs: completed && typeof params.completedAtMs === "number" ? params.completedAtMs : null,
      status: (["inProgress", "approved", "denied", "timedOut", "aborted"].includes(getString(review.status) ?? "") ? getString(review.status) : "inProgress") as ApprovalReviewState["status"],
      riskLevel: getString(review.riskLevel),
      userAuthorization: getString(review.userAuthorization),
      rationale: getString(review.rationale),
      decisionSource: getString(params.decisionSource),
      action: getRecord(params.action)
    };
    const reviews = pane.approvalReviews ?? (pane.approvalReviews = []);
    const index = reviews.findIndex((candidate) => candidate.reviewId === reviewId);
    if (index >= 0) reviews[index] = next;
    else reviews.push(next);
    const itemId = `auto-review:${reviewId}`;
    const item: UiItem = {
      id: itemId,
      turnId: next.turnId,
      type: "autoApprovalReview",
      data: { ...next },
      streamText: "",
      status: next.status === "inProgress" ? "running" : next.status === "denied" ? "declined" : next.status === "approved" ? "completed" : "failed"
    };
    const existingItem = findPaneItem(pane, itemId, next.turnId);
    if (existingItem) {
      Object.assign(existingItem, createUiItem(item));
    } else {
      appendPaneItem(pane, item);
    }
  };

  const mergeFileChangePatch = (pane: PaneState, params: Record<string, unknown>): void => {
    const itemId = getString(params.itemId);
    const turnId = getString(params.turnId) ?? pane.activeTurnId ?? "unknown-turn";
    if (!itemId) return;
    const changes = Array.isArray(params.changes) ? params.changes.map(getRecord) : [];
    const item = findPaneItem(pane, itemId, turnId);
    if (item) {
      item.type = "fileChange";
      item.data = markRaw({ ...item.data, changes });
      return;
    }
    appendPaneItem(pane, { id: itemId, turnId, type: "fileChange", data: { id: itemId, type: "fileChange", changes, status: "inProgress" }, streamText: "", status: "running" });
  };

  const mergeMcpProgress = (pane: PaneState, params: Record<string, unknown>): void => {
    const itemId = getString(params.itemId);
    const turnId = getString(params.turnId) ?? pane.activeTurnId ?? "unknown-turn";
    const message = getString(params.message);
    if (!itemId || !message) return;
    const item = findPaneItem(pane, itemId, turnId);
    if (item) item.data = markRaw({ ...item.data, progressMessage: message });
  };

  const syncSubAgentState = (pane: PaneState, item: UiItem): void => {
    const agents = pane.subAgents ?? (pane.subAgents = {});
    if (item.type === "subAgentActivity") {
      const threadId = getString(item.data.agentThreadId);
      if (!threadId) return;
      const kind = getString(item.data.kind) ?? "started";
      agents[threadId] = {
        threadId,
        path: getString(item.data.agentPath),
        status: kind === "interrupted" ? "interrupted" : "running",
        message: null
      };
      return;
    }
    if (item.type !== "collabAgentToolCall") return;
    for (const [threadId, rawState] of Object.entries(getRecord(item.data.agentsStates))) {
      const agentState = getRecord(rawState);
      const previous = agents[threadId];
      agents[threadId] = {
        threadId,
        path: previous?.path ?? null,
        status: getString(agentState.status) ?? previous?.status ?? "unknown",
        message: getString(agentState.message)
      };
    }
  };

  const mergeDelta = (pane: PaneState, params: Record<string, unknown>): void => {
    const itemId = getString(params.itemId);
    const turnId = getString(params.turnId) ?? pane.activeTurnId ?? "unknown-turn";
    if (!itemId) {
      return;
    }
    let item = findPaneItem(pane, itemId, turnId);
    if (!item) {
      item = appendPaneItem(pane, { id: itemId, turnId, type: "stream", data: {}, streamText: "", status: "running" });
    }
    const delta = getString(params.delta) ?? getString(params.output) ?? "";
    if (document.visibilityState === "hidden") {
      item.streamText += delta;
      return;
    }
    const key = `${pane.id}:${turnId}:${itemId}`;
    const buffered = deltaBuffers.get(key);
    if (buffered) {
      buffered.text += delta;
      return;
    }
    deltaBuffers.set(key, { item, text: delta });
    if (deltaFlushFrame === null) {
      deltaFlushFrame = window.requestAnimationFrame(() => {
        deltaFlushFrame = null;
        for (const bufferedKey of [...deltaBuffers.keys()]) flushDelta(bufferedKey);
      });
    }
  };

  const flushDelta = (key: string): void => {
    const buffered = deltaBuffers.get(key);
    if (!buffered) return;
    buffered.item.streamText += buffered.text;
    deltaBuffers.delete(key);
  };

  const addServerRequest = (event: ProtocolEvent): void => {
    const payload = getRecord(event.payload);
    const id = payload.id;
    const method = getString(payload.method);
    if ((typeof id !== "string" && typeof id !== "number") || !method) {
      return;
    }
    const params = getRecord(payload.params);
    const threadId = getString(params.threadId) ?? getString(params.conversationId);
    const pane = threadId ? state.value.panes.find((candidate) => candidate.threadId === threadId) : null;
    const duplicate = state.value.pendingRequests.some((request) => request.generation === event.generation && typeof request.id === typeof id && request.id === id);
    if (!duplicate) state.value.pendingRequests.push({ generation: event.generation, id, method, params, paneId: pane?.id ?? null, createdAt: Date.now() });
  };

  const findPaneForParams = (params: Record<string, unknown>): PaneState | null => {
    const threadId = getString(params.threadId) ?? getString(getRecord(params.thread).id);
    if (!threadId) {
      return null;
    }
    return state.value.panes.find((pane) => pane.threadId === threadId) ?? null;
  };

  const probeCapabilities = async (): Promise<void> => {
    const configurationCwd = state.value.defaultCwd || null;
    const results = await Promise.allSettled([
      window.codexPane.request({ method: "model/list", params: { limit: 100 } }),
      window.codexPane.request({ method: "account/read", params: { refreshToken: false } }),
      window.codexPane.request({ method: "account/rateLimits/read" }),
      window.codexPane.request({ method: "config/read", params: { includeLayers: false, cwd: configurationCwd } }),
      window.codexPane.request({ method: "permissionProfile/list", params: { cursor: null, limit: 100, cwd: configurationCwd } })
    ]);
    if (results[0]?.status === "fulfilled") {
      const response = getRecord(results[0].value);
      const data = Array.isArray(response.data) ? response.data : [];
      state.value.models = data.map((entry): ModelOption => {
        const model = getRecord(entry);
        const efforts = Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts.map((effort) => getString(getRecord(effort).reasoningEffort)).filter((effort): effort is string => Boolean(effort))
          : [];
        const modalities = Array.isArray(model.inputModalities) ? model.inputModalities.filter((item): item is string => typeof item === "string") : [];
        return {
          label: getString(model.displayName) ?? getString(model.id) ?? "未知模型",
          value: getString(model.id) ?? "",
          efforts,
          inputModalities: modalities,
          defaultEffort: getString(model.defaultReasoningEffort),
          isDefault: model.isDefault === true
        };
      }).filter((model) => model.value);
      const defaultModel = state.value.models.find((model) => model.isDefault) ?? state.value.models[0];
      if (defaultModel) {
        for (const pane of state.value.panes) {
          pane.model ??= defaultModel.value;
          pane.effort ??= defaultModel.defaultEffort;
        }
      }
    }
    if (results[1]?.status === "fulfilled") {
      const accountResponse = getRecord(results[1].value);
      const account = getRecord(accountResponse.account);
      const accountLabel = getString(account.email) ?? formatAuthMode(getString(account.type));
      const requiresOpenaiAuth = accountResponse.requiresOpenaiAuth;
      state.value.accountLabel = accountLabel ?? (requiresOpenaiAuth === false ? "API/自定义模式" : "未登录");
      if (!accountLabel && requiresOpenaiAuth !== false) addNotice("本机 Codex 尚未登录。请先在终端运行 codex login，再点击重新连接。" );
    } else {
      state.value.accountLabel = "API/自定义模式";
    }
    if (results[2]?.status === "fulfilled") {
      state.value.rateLimits = getRecord(results[2].value);
      updateRateLimitLabels(getRecord(results[2].value));
    }
    if (results[3]?.status === "fulfilled") {
      const config = getRecord(getRecord(results[3].value).config);
      state.value.effectiveConfig = {
        model: getString(config.model),
        modelProvider: getString(config.model_provider),
        sandboxMode: getString(config.sandbox_mode),
        approvalPolicy: getString(config.approval_policy),
        approvalReviewer: getString(config.approvals_reviewer),
        reasoningEffort: getString(config.model_reasoning_effort),
        webSearch: getString(config.web_search),
        serviceTier: getString(config.service_tier)
      };
    }
    if (results[4]?.status === "fulfilled") {
      const response = getRecord(results[4].value);
      state.value.permissionProfiles = (Array.isArray(response.data) ? response.data : []).map((entry) => {
        const profile = getRecord(entry);
        return { id: getString(profile.id) ?? "", description: getString(profile.description), allowed: profile.allowed === true };
      }).filter((profile) => profile.id);
    }
  };

  const updateRateLimitLabels = (response: Record<string, unknown>): void => {
    const byId = getRecord(response.rateLimitsByLimitId);
    const namedBuckets = Object.keys(byId).length
      ? Object.entries(byId).map(([id, bucket]) => ({ id, bucket: getRecord(bucket) }))
      : [getRecord(response.rateLimits)].filter((bucket) => Object.keys(bucket).length).map((bucket) => ({ id: "", bucket }));
    const seen = new Set<string>();
    state.value.rateLimitLabels = namedBuckets.flatMap(({ id, bucket }) => {
      const limits = [getRecord(bucket.primary), getRecord(bucket.secondary)].filter((limit) => Object.keys(limit).length);
      const bucketName = getString(bucket.limitName) ?? id;
      return limits.flatMap((limit) => {
        const minutes = typeof limit.windowDurationMins === "number" ? limit.windowDurationMins : null;
        const percent = typeof limit.usedPercent === "number" ? Math.round(Math.max(0, Math.min(100, 100 - limit.usedPercent))) : null;
        const reset = typeof limit.resetsAt === "number" ? limit.resetsAt : null;
        const identity = `${minutes ?? ""}:${reset ?? ""}:${percent ?? ""}`;
        if (seen.has(identity)) return [];
        seen.add(identity);
        const windowLabel = minutes === 300 ? "5小时" : minutes === 10080 ? "7天" : minutes ? `${minutes}分钟` : "额度";
        const bucketLabel = namedBuckets.length > 1 && bucketName ? `${bucketName.replace(/[_-]+/g, " ")} · ` : "";
        return [`${bucketLabel}${windowLabel} ${percent ?? "—"}%`];
      });
    });
  };

  const mergeRateLimitUpdate = (snapshot: Record<string, unknown>): void => {
    if (!Object.keys(snapshot).length) return;
    const current = getRecord(state.value.rateLimits);
    const currentById = { ...getRecord(current.rateLimitsByLimitId) };
    const limitId = getString(snapshot.limitId) ?? "codex";
    currentById[limitId] = { ...getRecord(currentById[limitId]), ...snapshot };
    const next = {
      ...current,
      rateLimits: limitId === "codex" || !Object.keys(getRecord(current.rateLimits)).length
        ? { ...getRecord(current.rateLimits), ...snapshot }
        : current.rateLimits,
      rateLimitsByLimitId: currentById
    };
    state.value.rateLimits = next;
    updateRateLimitLabels(next);
  };

  const normalizeMcpServer = (rawServer: unknown): McpServerState => {
    const server = getRecord(rawServer);
    const authStatus = getString(server.authStatus);
    return {
      name: getString(server.name) ?? "未知",
      pluginId: getString(server.pluginId),
      authStatus: (["unknown", "unsupported", "notLoggedIn", "bearerToken", "oAuth"].includes(authStatus ?? "") ? authStatus : "unknown") as McpServerState["authStatus"],
      startupStatus: null,
      error: null,
      failureReason: null,
      tools: Object.keys(getRecord(server.tools)),
      resourceCount: Array.isArray(server.resources) ? server.resources.length : 0,
      resourceTemplateCount: Array.isArray(server.resourceTemplates) ? server.resourceTemplates.length : 0
    };
  };

  const mergeMcpStartupStatus = (params: Record<string, unknown>): void => {
    const name = getString(params.name);
    if (!name) return;
    let server = state.value.mcpServers.find((candidate) => candidate.name === name);
    if (!server) {
      server = normalizeMcpServer({ name, authStatus: "unknown", tools: {}, resources: [], resourceTemplates: [] });
      state.value.mcpServers.push(server);
    }
    const status = getString(params.status);
    server.startupStatus = (["starting", "ready", "failed", "cancelled"].includes(status ?? "") ? status : null) as McpServerState["startupStatus"];
    server.error = getString(params.error);
    server.failureReason = getString(params.failureReason);
  };

  const refreshMcpServers = async (threadId: string | null = null): Promise<Record<string, unknown>> => {
    const response = getRecord(await window.codexPane.request({ method: "mcpServerStatus/list", params: { threadId, limit: 100, detail: "full" } }));
    const previous = new Map(state.value.mcpServers.map((server) => [server.name, server]));
    state.value.mcpServers = (Array.isArray(response.data) ? response.data : []).map((rawServer) => {
      const server = normalizeMcpServer(rawServer);
      const old = previous.get(server.name);
      if (old) {
        server.startupStatus = old.startupStatus;
        server.error = old.error;
        server.failureReason = old.failureReason;
      }
      return server;
    });
    return response;
  };

  const loginMcpServer = async (name: string, pane?: PaneState): Promise<void> => {
    const threadId = pane?.threadId ?? null;
    const response = getRecord(await window.codexPane.request({ method: "mcpServer/oauth/login", params: { name, threadId } }));
    const authorizationUrl = getString(response.authorizationUrl);
    if (!authorizationUrl) throw new Error("Codex 未返回 MCP 登录地址。" );
    await window.codexPane.openExternal(authorizationUrl);
  };

  const normalizeBackgroundTerminal = (rawTerminal: unknown): BackgroundTerminalState | null => {
    const terminal = getRecord(rawTerminal);
    const processId = getString(terminal.processId);
    if (!processId) return null;
    return {
      itemId: getString(terminal.itemId) ?? "",
      processId,
      command: getString(terminal.command) ?? "",
      cwd: getString(terminal.cwd) ?? "",
      osPid: typeof terminal.osPid === "number" ? terminal.osPid : null,
      cpuPercent: typeof terminal.cpuPercent === "number" ? terminal.cpuPercent : null,
      rssKb: typeof terminal.rssKb === "number" ? terminal.rssKb : null
    };
  };

  const refreshBackgroundTerminals = async (pane: PaneState): Promise<BackgroundTerminalState[]> => {
    const threadId = await ensureThread(pane);
    const response = getRecord(await window.codexPane.request({ method: "thread/backgroundTerminals/list", params: { threadId, cursor: null, limit: 100 } }));
    pane.backgroundTerminals = (Array.isArray(response.data) ? response.data : [])
      .map(normalizeBackgroundTerminal)
      .filter((terminal): terminal is BackgroundTerminalState => Boolean(terminal));
    return pane.backgroundTerminals;
  };

  const stopBackgroundProcess = async (pane: PaneState, processId: string): Promise<boolean> => {
    if (!pane.threadId) return false;
    const response = getRecord(await window.codexPane.request({ method: "thread/backgroundTerminals/terminate", params: { threadId: pane.threadId, processId } }));
    await refreshBackgroundTerminals(pane);
    return response.terminated === true;
  };

  const stopAllBackgroundProcesses = async (pane: PaneState): Promise<{ requested: number; terminated: number }> => {
    const terminals = await refreshBackgroundTerminals(pane);
    let terminated = 0;
    for (const terminal of terminals) {
      const response = getRecord(await window.codexPane.request({ method: "thread/backgroundTerminals/terminate", params: { threadId: pane.threadId!, processId: terminal.processId } }));
      if (response.terminated === true) terminated += 1;
    }
    await refreshBackgroundTerminals(pane);
    return { requested: terminals.length, terminated };
  };

  const refreshAccountUsage = async (threadId: string | null = null): Promise<void> => {
    state.value.accountUsage = getRecord(await window.codexPane.request({ method: "account/usage/read", params: { threadId } }));
  };

  const addNotice = (message: string): void => {
    if (!message || state.value.notices.at(-1) === message) return;
    state.value.notices.push(message);
    if (state.value.notices.length > 10) state.value.notices.shift();
  };

  const dismissNotice = (): void => {
    state.value.notices.pop();
  };

  const resumeBoundThreads = async (): Promise<void> => {
    const operations = state.value.panes.flatMap((pane) => {
      if (!pane.threadId) return [];
      const existing = paneReadiness.get(pane.id);
      if (existing) return [existing];
      const requestedThreadId = pane.threadId;
      pane.status = "starting";
      const operation = window.codexPane.request({
        method: "thread/resume",
        params: {
          threadId: requestedThreadId,
          excludeTurns: true,
          initialTurnsPage: { limit: HISTORY_TURN_PAGE_SIZE, sortDirection: "desc", itemsView: "full" }
        }
      })
        .then((response) => {
          if (pane.threadId !== requestedThreadId) return;
          const result = getRecord(response);
          hydrateThread(pane, getRecord(result.thread), getRecord(result.initialTurnsPage));
          pane.error = null;
        })
        .catch((error) => {
          if (pane.threadId !== requestedThreadId) return;
          pane.status = "error";
          pane.error = `无法恢复会话：${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => paneReadiness.delete(pane.id));
      paneReadiness.set(pane.id, operation);
      return [operation];
    });
    await Promise.all(operations);
  };

  const loadThreads = async (searchTerm = "", cwd: string | null = null): Promise<void> => {
    const requestId = ++threadListRequestId;
    const response = getRecord(await window.codexPane.request({
      method: "thread/list",
      params: { limit: 100, sortKey: "updated_at", sortDirection: "desc", searchTerm: searchTerm || null, cwd }
    }));
    if (requestId !== threadListRequestId) return;
    const data = Array.isArray(response.data) ? response.data : [];
    state.value.threads = data.map((rawThread): ThreadSummary => {
      const thread = getRecord(rawThread);
      return {
        id: getString(thread.id) ?? "",
        name: getString(thread.name),
        preview: getString(thread.preview) ?? "无预览内容",
        cwd: getString(thread.cwd) ?? "",
        updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : 0,
        status: getString(getRecord(thread.status).type) ?? getString(thread.status) ?? "notLoaded"
      };
    }).filter((thread) => thread.id);
  };

  const resumeThread = async (pane: PaneState, threadId: string): Promise<void> => {
    if (pane.activeTurnId || pane.status === "running" || pane.status === "interrupting" || pane.status === "starting" || state.value.pendingRequests.some((request) => request.paneId === pane.id)) {
      throw new Error("当前任务仍在运行，请先中断并等待结束后再恢复其他会话。" );
    }
    const duplicate = state.value.panes.find((candidate) => candidate.id !== pane.id && candidate.threadId === threadId);
    if (duplicate) {
      throw new Error(`该会话已绑定到${duplicate.title}，不能同时在两个可编辑窗格中打开。`);
    }
    pane.status = "starting";
    try {
      const response = getRecord(await window.codexPane.request({
        method: "thread/resume",
        params: {
          threadId,
          excludeTurns: true,
          initialTurnsPage: { limit: HISTORY_TURN_PAGE_SIZE, sortDirection: "desc", itemsView: "full" }
        }
      }));
      hydrateThread(pane, getRecord(response.thread), getRecord(response.initialTurnsPage));
      pane.cwd = getString(response.cwd) ?? pane.cwd;
      pane.model = getString(response.model) ?? pane.model;
      pane.effort = getString(response.reasoningEffort) ?? pane.effort;
      pane.activePermissionProfile = getString(getRecord(response.activePermissionProfile).id);
      pane.error = null;
      scheduleSave();
    } catch (error) {
      pane.status = "error";
      pane.error = `无法恢复会话：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  };

  const createItemsFromTurns = (rawTurns: unknown[]): UiItem[] => rawTurns.flatMap((rawTurn) => {
    const turn = getRecord(rawTurn);
    const turnId = getString(turn.id) ?? "unknown-turn";
    const items = Array.isArray(turn.items) ? turn.items : [];
    return items.map((rawItem): UiItem => {
      const item = getRecord(rawItem);
      return createUiItem({ id: getString(item.id) ?? crypto.randomUUID(), turnId, type: getString(item.type) ?? "unknown", data: item, streamText: "", status: resolveItemStatus(item, getString(turn.status) !== "inProgress") });
    });
  });

  const hydrateThread = (pane: PaneState, thread: Record<string, unknown>, historyPage: Record<string, unknown> | null = null): void => {
    discardPaneDeltas(pane.id);
    historyRequestTokens.delete(pane.id);
    const threadId = getString(thread.id);
    if (threadId) {
      pane.threadId = threadId;
    }
    pane.title = getString(thread.name) || defaultPaneTitle(pane);
    const pagedTurns = historyPage && Array.isArray(historyPage.data) ? [...historyPage.data].reverse() : null;
    const turns = pagedTurns ?? (Array.isArray(thread.turns) ? thread.turns : []);
    const activeTurn = [...turns].reverse().map(getRecord).find((turn) => getString(turn.status) === "inProgress") ?? null;
    pane.activeTurnId = activeTurn ? getString(activeTurn.id) : null;
    pane.status = pane.activeTurnId ? "running" : "idle";
    pane.turnDiff = "";
    pane.activeFlags = [];
    pane.approvalReviews = [];
    pane.strictReviewRequired = false;
    pane.backgroundTerminals = [];
    pane.subAgents = {};
    pane.activePermissionProfile = null;
    pane.items = createItemsFromTurns(turns);
    pane.historyCursor = historyPage ? getString(historyPage.nextCursor) : null;
    pane.historyLoading = false;
    indexPaneItems(pane);
    for (const item of pane.items) syncSubAgentState(pane, item);
  };

  const loadOlderTurns = async (pane: PaneState): Promise<void> => {
    if (!pane.threadId || !pane.historyCursor || pane.historyLoading) return;
    pane.historyLoading = true;
    const requestedThreadId = pane.threadId;
    const cursor = pane.historyCursor;
    const requestToken = Symbol("history-request");
    historyRequestTokens.set(pane.id, requestToken);
    try {
      const response = getRecord(await window.codexPane.request({
        method: "thread/turns/list",
        params: { threadId: requestedThreadId, cursor, limit: HISTORY_TURN_PAGE_SIZE, sortDirection: "desc", itemsView: "full" }
      }));
      if (historyRequestTokens.get(pane.id) !== requestToken || pane.threadId !== requestedThreadId || pane.historyCursor !== cursor) return;
      const turns = Array.isArray(response.data) ? [...response.data].reverse() : [];
      const knownItems = paneItemIndexes.get(pane.id) ?? new Map<string, UiItem>();
      const olderItems = createItemsFromTurns(turns).filter((item) => !knownItems.has(itemKey(item.turnId, item.id)));
      if (olderItems.length) {
        pane.items = [...olderItems, ...pane.items];
        indexPaneItems(pane);
        for (const item of olderItems) syncSubAgentState(pane, item);
      }
      pane.historyCursor = getString(response.nextCursor);
    } catch (error) {
      if (historyRequestTokens.get(pane.id) === requestToken && pane.threadId === requestedThreadId) {
        pane.error = `无法加载更早内容：${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (historyRequestTokens.get(pane.id) === requestToken) {
        historyRequestTokens.delete(pane.id);
        pane.historyLoading = false;
      }
    }
  };

  const defaultPaneTitle = (pane: PaneState): string => {
    const firstUserMessage = pane.items.find((item) => item.type === "userMessage");
    const content = Array.isArray(firstUserMessage?.data.content) ? firstUserMessage.data.content : [];
    const firstText = content.map(getRecord).map((entry) => getString(entry.text)).find(Boolean);
    return firstText?.trim().slice(0, 48) || "新会话";
  };

  const ensureThread = async (pane: PaneState): Promise<string> => {
    const readiness = paneReadiness.get(pane.id);
    if (readiness) await readiness;
    if (pane.threadId) {
      return pane.threadId;
    }
    const existingCreation = threadCreations.get(pane.id);
    if (existingCreation) return existingCreation;
    pane.status = "starting";
    const effectiveCwd = pane.cwd || state.value.defaultCwd || null;
    const creation = window.codexPane.request({
      method: "thread/start",
      params: { cwd: effectiveCwd, model: pane.model, ephemeral: false }
    }).then((rawResponse) => {
      const response = getRecord(rawResponse);
      const thread = getRecord(response.thread);
      const threadId = getString(thread.id);
      if (!threadId) throw new Error("Codex 未返回会话标识。" );
      pane.threadId = threadId;
      pane.model = getString(response.model) ?? pane.model;
      pane.effort = getString(response.reasoningEffort) ?? pane.effort;
      pane.activePermissionProfile = getString(getRecord(response.activePermissionProfile).id);
      pane.cwd = getString(response.cwd) ?? effectiveCwd ?? "";
      pane.status = "idle";
      scheduleSave();
      return threadId;
    }).finally(() => threadCreations.delete(pane.id));
    threadCreations.set(pane.id, creation);
    return creation;
  };

  const send = async (pane: PaneState): Promise<void> => {
    const text = pane.draft.trim();
    if ((!text && pane.attachments.length === 0 && pane.references.length === 0) || pane.status === "interrupting" || sendsInFlight.has(pane.id)) {
      return;
    }
    const submittedAttachments = pane.attachments.map((attachment) => ({ ...attachment }));
    const submittedReferences = pane.references.map((reference) => ({ ...reference }));
    const mentionedNames = new Set([...text.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((match) => match[1]!.replace(/[.,;:!?，。；：！？]+$/g, "").toLocaleLowerCase()));
    const submittedSkills = pane.skills.filter((skill) => mentionedNames.has(skill.name.toLocaleLowerCase()));
    const clientUserMessageId = crypto.randomUUID();
    const optimisticId = `client:${clientUserMessageId}`;
    const optimisticItem: UiItem = {
      id: optimisticId,
      turnId: pane.activeTurnId ?? `pending:${clientUserMessageId}`,
      type: "userMessage",
      data: {
        id: optimisticId,
        type: "userMessage",
        clientId: clientUserMessageId,
        content: [
          ...(text ? [{ type: "text", text, text_elements: [] }] : []),
          ...submittedSkills.map((skill) => ({ type: "skill", name: skill.name, path: skill.path })),
          ...submittedReferences.map((reference) => ({ type: "mention", name: reference.name, path: reference.path })),
          ...submittedAttachments.map((attachment) => attachment.kind === "remote"
            ? { type: "image", url: attachment.url }
            : { type: "localImage", path: attachment.name })
        ]
      },
      streamText: "",
      status: "running"
    };
    sendsInFlight.add(pane.id);
    appendPaneItem(pane, optimisticItem);
    if (pane.title === "新会话" && text) pane.title = text.slice(0, 48);
    pane.status = "running";
    pane.error = null;
    pane.draft = "";
    pane.attachments = [];
    pane.references = [];
    try {
      const threadId = await ensureThread(pane);
      const input: Array<
        { type: "text"; text: string; text_elements: unknown[] }
        | { type: "managedImage"; id: string; detail: "high" }
        | { type: "managedRemoteImage"; url: string; detail: "high" }
        | { type: "managedFile"; id: string; name: string }
        | { type: "skill"; name: string; path: string }
        | { type: "mention"; name: string; path: string }
      > = [];
      if (text) {
        input.push({ type: "text", text, text_elements: [] });
      }
      for (const skill of submittedSkills) input.push({ type: "skill", name: skill.name, path: skill.path });
      for (const reference of submittedReferences) {
        input.push(reference.managed
          ? { type: "managedFile", id: reference.id, name: reference.name }
          : { type: "mention", name: reference.name, path: reference.path });
      }
      for (const attachment of submittedAttachments) {
        if (attachment.kind === "remote") {
          if (!attachment.sourceUrl) throw new Error("远程图片地址已失效，请移除后重新添加。" );
          input.push({ type: "managedRemoteImage", url: attachment.sourceUrl, detail: "high" });
        } else {
          input.push({ type: "managedImage", id: attachment.id, detail: "high" });
        }
      }
      if (pane.activeTurnId) {
        await window.codexPane.request({ method: "turn/steer", params: { threadId, clientUserMessageId, expectedTurnId: pane.activeTurnId, input } });
      } else {
        const response = getRecord(await window.codexPane.request({ method: "turn/start", params: { threadId, clientUserMessageId, input, model: pane.model, effort: pane.effort } }));
        pane.activeTurnId = getString(getRecord(response.turn).id);
      }
      scheduleSave();
    } catch (error) {
      pane.status = "error";
      pane.error = error instanceof Error ? error.message : String(error);
      if (optimisticItem.id === optimisticId) {
        pane.items = pane.items.filter((item) => item !== optimisticItem);
        paneItemIndexes.get(pane.id)?.delete(itemKey(optimisticItem.turnId, optimisticItem.id));
        if (text) pane.draft = pane.draft ? `${text}\n${pane.draft}` : text;
        const currentAttachmentIds = new Set(pane.attachments.map((attachment) => attachment.id));
        pane.attachments = [...submittedAttachments.filter((attachment) => !currentAttachmentIds.has(attachment.id)), ...pane.attachments];
        const currentReferenceIds = new Set(pane.references.map((reference) => reference.id));
        pane.references = [...submittedReferences.filter((reference) => !currentReferenceIds.has(reference.id)), ...pane.references];
      }
      scheduleSave();
    } finally {
      sendsInFlight.delete(pane.id);
    }
  };

  const executeSlashCommand = async (pane: PaneState, command: string): Promise<void> => {
    try {
      if (command === "status") {
        const lastUsage = getRecord(pane.tokenUsage?.last);
        const usedTokens = typeof lastUsage.totalTokens === "number" ? Math.max(0, Math.round(lastUsage.totalTokens)) : 0;
        const totalTokens = typeof pane.tokenUsage?.modelContextWindow === "number" ? Math.max(0, Math.round(pane.tokenUsage.modelContextWindow)) : 0;
        pane.items.push({
          id: crypto.randomUUID(),
          turnId: "local",
          type: "status",
          data: {
            connection: state.value.connection.message,
            threadId: pane.threadId ?? "未创建",
            account: state.value.accountLabel === "—" ? "未登录" : state.value.accountLabel,
            model: pane.model ?? "未设置",
            effort: pane.effort ?? "未设置",
            cwd: pane.cwd || state.value.defaultCwd || "未设置",
            contextTokens: `${usedTokens.toLocaleString("en-US")}/${totalTokens.toLocaleString("en-US")}`,
            backgroundProcessCount: pane.backgroundTerminals?.length ?? 0,
            approvalState: pane.strictReviewRequired ? "需要严格复核" : pane.activeFlags?.includes("waitingOnApproval") ? "等待确认" : "无需确认",
            quotas: state.value.rateLimitLabels.length ? state.value.rateLimitLabels : ["无额度数据"]
          },
          streamText: "",
          status: "completed"
        });
        return;
      }
      if (command === "cwd") {
        await chooseDirectory(pane);
        return;
      }
      const threadId = await ensureThread(pane);
      if (command === "compact") {
        await window.codexPane.request({ method: "thread/compact/start", params: { threadId } });
        return;
      }
      if (command === "review") {
        await window.codexPane.request({ method: "review/start", params: { threadId, target: { type: "uncommittedChanges" }, delivery: "inline" } });
        return;
      }
      if (command === "agents") {
        const result = getRecord(await window.codexPane.request({
          method: "thread/list",
          params: {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            searchTerm: null,
            ancestorThreadId: threadId,
            sourceKinds: ["subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"]
          }
        }));
        pane.items.push({ id: crypto.randomUUID(), turnId: "local", type: "agents", data: { agents: Array.isArray(result.data) ? result.data : [] }, streamText: "", status: "completed" });
        return;
      }
      if (command === "processes") {
        const processes = await refreshBackgroundTerminals(pane);
        pane.items.push({ id: crypto.randomUUID(), turnId: "local", type: "backgroundProcesses", data: { processes }, streamText: "", status: "completed" });
        return;
      }
      if (command === "kill-processes") {
        const result = await stopAllBackgroundProcesses(pane);
        pane.items.push({ id: crypto.randomUUID(), turnId: "local", type: "backgroundProcesses", data: { processes: [], result }, streamText: "", status: "completed" });
        return;
      }
      if (command === "permissions") {
        pane.items.push({
          id: crypto.randomUUID(),
          turnId: "local",
          type: "permissions",
          data: { profiles: state.value.permissionProfiles.filter((profile) => profile.allowed), currentProfile: pane.activePermissionProfile },
          streamText: "",
          status: "completed"
        });
        return;
      }
      const result = command === "mcp"
        ? await refreshMcpServers(threadId)
        : getRecord(await window.codexPane.request({ method: "skills/list", params: { cwds: pane.cwd ? [pane.cwd] : [], forceReload: false } }));
      if (command === "skills") updatePaneSkills(pane, result);
      pane.items.push({ id: crypto.randomUUID(), turnId: "local", type: command === "mcp" ? "mcpStatus" : "skills", data: result, streamText: "", status: "completed" });
    } catch (error) {
      pane.error = `命令执行失败：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const handleItemAction = async (
    pane: PaneState,
    action: { type: "switchAgent"; threadId: string } | { type: "stopBackgroundProcess"; processId: string } | { type: "stopAllBackgroundProcesses" } | { type: "switchPermissionProfile"; profileId: string }
  ): Promise<void> => {
    if (action.type === "switchAgent") {
      await resumeThread(pane, action.threadId);
      return;
    }
    if (action.type === "stopBackgroundProcess") {
      await stopBackgroundProcess(pane, action.processId);
      return;
    }
    if (action.type === "switchPermissionProfile") {
      const profile = state.value.permissionProfiles.find((candidate) => candidate.id === action.profileId && candidate.allowed);
      if (!profile) {
        pane.error = "这个权限模式当前不可用。";
        return;
      }
      const threadId = await ensureThread(pane);
      await window.codexPane.request({ method: "thread/settings/update", params: { threadId, permissions: profile.id } });
      pane.activePermissionProfile = profile.id;
      for (const item of pane.items.filter((candidate) => candidate.type === "permissions")) item.data.currentProfile = profile.id;
      pane.error = null;
      return;
    }
    await stopAllBackgroundProcesses(pane);
  };

  const interrupt = async (pane: PaneState): Promise<void> => {
    if (!pane.threadId || !pane.activeTurnId) {
      return;
    }
    pane.status = "interrupting";
    try {
      await window.codexPane.request({ method: "turn/interrupt", params: { threadId: pane.threadId, turnId: pane.activeTurnId } });
    } catch (error) {
      pane.error = error instanceof Error ? error.message : String(error);
      pane.status = "running";
    }
  };

  const newThread = (pane: PaneState): void => {
    if (pane.activeTurnId || pane.status === "running" || pane.status === "interrupting" || pane.status === "starting" || state.value.pendingRequests.some((request) => request.paneId === pane.id)) {
      pane.error = "当前任务或确认请求尚未结束，请处理完成后再新建会话。";
      return;
    }
    pane.threadId = null;
    pane.activeTurnId = null;
    pane.status = "idle";
    pane.items = [];
    discardPaneDeltas(pane.id);
    paneItemIndexes.delete(pane.id);
    historyRequestTokens.delete(pane.id);
    pane.historyCursor = null;
    pane.historyLoading = false;
    pane.tokenUsage = null;
    pane.contextRemainingPercent = null;
    pane.turnDiff = "";
    pane.activeFlags = [];
    pane.approvalReviews = [];
    pane.strictReviewRequired = false;
    pane.backgroundTerminals = [];
    pane.subAgents = {};
    pane.error = null;
    pane.unread = false;
    scheduleSave();
  };

  const resetPane = (pane: PaneState): void => {
    discardPaneDeltas(pane.id);
    paneItemIndexes.delete(pane.id);
    historyRequestTokens.delete(pane.id);
    pane.title = "新会话";
    pane.threadId = null;
    pane.draft = "";
    pane.attachments = [];
    pane.references = [];
    pane.skills = [];
    pane.activePermissionProfile = null;
    pane.activeTurnId = null;
    pane.status = "idle";
    pane.items = [];
    pane.tokenUsage = null;
    pane.contextRemainingPercent = null;
    pane.turnDiff = "";
    pane.activeFlags = [];
    pane.approvalReviews = [];
    pane.strictReviewRequired = false;
    pane.backgroundTerminals = [];
    pane.subAgents = {};
    pane.error = null;
    pane.unread = false;
    pane.scrollTop = 0;
    pane.followTail = true;
    pane.historyCursor = null;
    pane.historyLoading = false;
  };

  const setLayout = (layout: LayoutKind): void => {
    state.value.layout = layout;
    state.value.focusedPaneId = null;
    scheduleSave();
  };

  const toggleFocus = (paneId: string): void => {
    state.value.focusedPaneId = state.value.focusedPaneId === paneId ? null : paneId;
    scheduleSave();
  };

  const setSplitSizes = (key: string, sizes: number[]): void => {
    if (sizes.length >= 2 && sizes.every((size) => Number.isFinite(size) && size >= 10 && size <= 90)) {
      state.value.splitSizes[key] = sizes;
      scheduleSave();
    }
  };

  const chooseDirectory = async (pane: PaneState): Promise<void> => {
    const cwd = await window.codexPane.chooseDirectory();
    if (cwd) {
      if (pane.threadId) {
        await window.codexPane.request({ method: "thread/settings/update", params: { threadId: pane.threadId, cwd } });
      }
      pane.cwd = cwd;
      scheduleSave();
    }
  };

  const updateAppearance = (appearance: Partial<AppearanceSettings>): void => {
    state.value.appearance = { ...state.value.appearance, ...appearance };
    scheduleSave();
  };

  const chooseDefaultDirectory = async (): Promise<void> => {
    const cwd = await window.codexPane.chooseDirectory();
    if (cwd) {
      await window.codexPane.setAppServerWorkingDirectory(cwd);
      state.value.defaultCwd = cwd;
      addNotice("全局默认工作目录已保存；下次重新连接时，codex app-server 将从该目录启动。" );
      scheduleSave();
    }
  };

  const clearDefaultDirectory = async (): Promise<void> => {
    await window.codexPane.setAppServerWorkingDirectory(null);
    state.value.defaultCwd = "";
    addNotice("已清除全局默认工作目录；下次重新连接时，codex app-server 将使用应用目录。" );
    scheduleSave();
  };

  const addAttachmentBatch = (pane: PaneState, batch: { images: PaneState["attachments"]; files: PaneState["references"] }): void => {
    pane.attachments.push(...batch.images);
    pane.references.push(...batch.files);
    pane.error = null;
    scheduleSave();
  };

  const chooseAttachments = async (pane: PaneState): Promise<void> => {
    const available = 20 - pane.attachments.length - pane.references.length;
    if (available <= 0) {
      pane.error = "每个窗格最多添加 20 个附件，请先移除部分附件。";
      return;
    }
    try {
      const batch = await window.codexPane.chooseAttachments(available);
      if (batch.images.length || batch.files.length) addAttachmentBatch(pane, batch);
    } catch (error) {
      pane.error = `无法添加附件：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const pasteAttachments = async (pane: PaneState, paths: string[]): Promise<void> => {
    const available = 20 - pane.attachments.length - pane.references.length;
    if (available <= 0) {
      pane.error = "每个窗格最多添加 20 个附件，请先移除部分附件。";
      return;
    }
    try {
      const batch = await window.codexPane.pasteAttachments(paths, available);
      if (batch.images.length || batch.files.length) addAttachmentBatch(pane, batch);
    } catch (error) {
      pane.error = `无法粘贴附件：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const updatePaneSkills = (pane: PaneState, result: Record<string, unknown>): void => {
    const entries = Array.isArray(result.data) ? result.data.flatMap((entry) => {
      const skills = getRecord(entry).skills;
      return Array.isArray(skills) ? skills : [];
    }) : [];
    pane.skills = entries.map(getRecord)
      .filter((skill) => skill.enabled !== false)
      .map((skill) => ({ name: getString(skill.name) ?? "", description: getString(skill.description) ?? "", path: getString(skill.path) ?? "" }))
      .filter((skill) => skill.name && skill.path);
  };

  const refreshSkills = async (pane: PaneState): Promise<void> => {
    try {
      const result = getRecord(await window.codexPane.request({ method: "skills/list", params: { cwds: [pane.cwd || state.value.defaultCwd].filter(Boolean), forceReload: false } }));
      updatePaneSkills(pane, result);
    } catch (error) {
      pane.error = `无法读取 Skills：${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const removeAttachment = (pane: PaneState, id: string): void => {
    pane.attachments = pane.attachments.filter((attachment) => attachment.id !== id);
    scheduleSave();
  };

  const removeReference = (pane: PaneState, id: string): void => {
    pane.references = pane.references.filter((reference) => reference.id !== id);
    scheduleSave();
  };

  const clearUnread = (pane: PaneState): void => {
    pane.unread = false;
  };

  const resolveRequest = async (request: PendingServerRequest, result?: unknown, error?: { code: number; message: string }): Promise<void> => {
    const responseKey = `${request.generation}:${typeof request.id}:${String(request.id)}`;
    if (responsesInFlight.has(responseKey)) return;
    responsesInFlight.add(responseKey);
    try {
      await window.codexPane.respond({ generation: request.generation, id: request.id, result, error });
      state.value.pendingRequests = state.value.pendingRequests.filter((candidate) => candidate !== request);
    } catch (responseError) {
      const message = `确认结果未提交：${responseError instanceof Error ? responseError.message : String(responseError)}`;
      const pane = request.paneId ? state.value.panes.find((candidate) => candidate.id === request.paneId) : null;
      if (pane) pane.error = message;
      addNotice(message);
      throw responseError;
    } finally {
      responsesInFlight.delete(responseKey);
    }
  };

  const reconnect = async (): Promise<void> => {
    if (state.value.pendingRequests.length || state.value.panes.some((pane) => pane.activeTurnId || pane.status === "running" || pane.status === "interrupting")) {
      addNotice("仍有任务或确认请求未完成。请先中断或处理完成后再重新连接。" );
      return;
    }
    await window.codexPane.reconnect();
  };

  const scheduleSave = (): void => {
    if (!state.value.initialized) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      // Main process replaces this snapshot with trusted BrowserWindow bounds.
      const windowState = { width: Math.max(800, window.innerWidth), height: Math.max(600, window.innerHeight), maximized: false };
      void window.codexPane.saveWorkspace({
        version: 1,
        layout: state.value.layout,
        splitSizes: Object.fromEntries(Object.entries(state.value.splitSizes).map(([key, sizes]) => [key, [...sizes]])),
        defaultCwd: state.value.defaultCwd,
        appearance: { ...state.value.appearance },
        focusedPaneId: state.value.focusedPaneId,
        panes: state.value.panes.map(({ id, threadId, cwd, draft, attachments, references, model, effort, scrollTop, followTail }) => ({
          id,
          threadId,
          cwd,
          draft,
          attachments: attachments.map((attachment) => ({ ...attachment })),
          references: references.map((reference) => ({ ...reference })),
          model,
          effort,
          scrollTop,
          followTail
        })),
        window: windowState
      }).catch((error) => {
        const pane = state.value.panes[0];
        if (pane) pane.error = `无法保存工作台：${error instanceof Error ? error.message : String(error)}`;
      });
    }, 400);
  };

  watch(() => state.value.panes.map((pane) => [pane.draft, pane.model, pane.effort]), scheduleSave, { deep: true });

  return {
    state,
    visiblePanes,
    pendingCount,
    initialize,
    send,
    executeSlashCommand,
    handleItemAction,
    interrupt,
    newThread,
    resetPane,
    setLayout,
    toggleFocus,
    setSplitSizes,
    updateAppearance,
    chooseDirectory,
    chooseDefaultDirectory,
    clearDefaultDirectory,
    chooseAttachments,
    pasteAttachments,
    refreshSkills,
    loadThreads,
    resumeThread,
    loadOlderTurns,
    removeAttachment,
    removeReference,
    clearUnread,
    resolveRequest,
    reconnect,
    dismissNotice,
    refreshMcpServers,
    loginMcpServer,
    refreshBackgroundTerminals,
    stopBackgroundProcess,
    stopAllBackgroundProcesses,
    refreshAccountUsage,
    scheduleSave
  };
});
