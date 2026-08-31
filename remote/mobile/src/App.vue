<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { darkTheme, NAlert, NButton, NConfigProvider, NInput, NSpin } from "naive-ui";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { DesktopEvent, MobileCommand, MobileItem, MobileSnapshot } from "@codex-pane/remote-protocol";
import { RemoteClient } from "./remote-client";
import { isNearConversationBottom } from "./scroll";

const emptySnapshot = (): MobileSnapshot => ({ deviceOnline: false, codexState: "stopped", codexMessage: "桌面未连接", activeThreadId: null, activeThreadTitle: "Codex Pane", turnStatus: "idle", threads: [], items: [] });
const snapshot = ref(emptySnapshot());
const error = ref("");
const connectionState = ref<"connecting" | "connected" | "disconnected">("disconnected");
const connectionMessage = ref("桌面未连接");
const sessionMenuOpen = ref(false);
const draft = ref("");
const pendingCommands = reactive(new Map<string, MobileCommand["type"]>());
const resolvingApprovals = reactive(new Set<string>());
const sentDrafts = new Map<string, string>();
const scrollContainer = ref<HTMLElement | null>(null);
const followTail = ref(true);
const unread = ref(0);
let client: RemoteClient | null = null;
const approvalResolutions = new Map<string, Extract<MobileItem, { kind: "approval" }>>();
const markdownCache = new Map<string, { source: string; html: string }>();

const sending = computed(() => [...pendingCommands.values()].includes("turn.send"));
const threadBusy = computed(() => [...pendingCommands.values()].some((type) => type === "thread.new" || type === "thread.open"));
const desktopReady = computed(() => connectionState.value === "connected" && snapshot.value.deviceOnline && snapshot.value.codexState === "ready");
const canSend = computed(() => desktopReady.value && Boolean(snapshot.value.activeThreadId) && draft.value.trim().length > 0 && !sending.value);
const statusClass = computed(() => desktopReady.value ? "online" : "offline");

const markdown = (id: string, value: string): string => {
  const cached = markdownCache.get(id);
  if (cached?.source === value) return cached.html;
  const container = document.createElement("div");
  container.innerHTML = DOMPurify.sanitize(marked.parse(value, { async: false }) as string);
  for (const anchor of container.querySelectorAll("a")) {
    try {
      const url = new URL(anchor.href, location.origin);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported link");
      anchor.href = url.toString();
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    } catch { anchor.replaceWith(document.createTextNode(anchor.textContent ?? "")); }
  }
  const html = container.innerHTML;
  markdownCache.set(id, { source: value, html });
  while (markdownCache.size > 300) markdownCache.delete(markdownCache.keys().next().value!);
  return html;
};
const nearBottom = (): boolean => {
  const element = scrollContainer.value;
  return !element || isNearConversationBottom(element.scrollHeight, element.scrollTop, element.clientHeight);
};
const scrollLatest = async (): Promise<void> => {
  followTail.value = true;
  unread.value = 0;
  await nextTick();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (scrollContainer.value) scrollContainer.value.scrollTop = Math.max(0, scrollContainer.value.scrollHeight - scrollContainer.value.clientHeight);
  }));
};
const updateItems = async (operation: () => void): Promise<void> => {
  const shouldFollow = followTail.value && nearBottom();
  operation();
  if (shouldFollow) await scrollLatest();
  else unread.value += 1;
};
const handleScroll = (): void => {
  followTail.value = nearBottom();
  if (followTail.value) unread.value = 0;
};

const handleEvent = (event: DesktopEvent): void => {
  if (event.type === "snapshot") {
    void updateItems(() => { snapshot.value = event.snapshot; connectionMessage.value = event.snapshot.deviceOnline ? "桌面已连接" : "桌面未连接"; });
    return;
  }
  if (event.type === "device.status") {
    snapshot.value.deviceOnline = event.online;
    snapshot.value.codexState = event.codexState;
    snapshot.value.codexMessage = event.message;
    connectionMessage.value = event.message;
    return;
  }
  if (event.type === "thread.summary") {
    const index = snapshot.value.threads.findIndex((thread) => thread.id === event.thread.id);
    if (index >= 0) snapshot.value.threads[index] = event.thread;
    else snapshot.value.threads.push(event.thread);
    return;
  }
  if (event.type === "item.upsert") {
    void updateItems(() => {
      const index = snapshot.value.items.findIndex((item) => item.id === event.item.id);
      if (index >= 0) snapshot.value.items[index] = event.item;
      else snapshot.value.items.push(event.item);
    });
    return;
  }
  if (event.type === "approval.request") void updateItems(() => {
    const index = snapshot.value.items.findIndex((item) => item.id === event.approval.id);
    if (index >= 0) snapshot.value.items[index] = event.approval;
    else snapshot.value.items.push(event.approval);
  });
  if (event.type === "turn.status" && event.threadId === snapshot.value.activeThreadId) snapshot.value.turnStatus = event.status;
  if (event.type === "desktop.required" || event.type === "notice") error.value = event.message;
  if (event.type === "command.result") {
    const commandType = pendingCommands.get(event.requestId);
    pendingCommands.delete(event.requestId);
    const approval = approvalResolutions.get(event.requestId);
    approvalResolutions.delete(event.requestId);
    if (!event.ok) {
      const sentDraft = sentDrafts.get(event.requestId);
      if (commandType === "turn.send" && sentDraft && !draft.value.trim()) draft.value = sentDraft;
      if (approval && !snapshot.value.items.some((item) => item.id === approval.id)) snapshot.value.items.push(approval);
      error.value = event.message;
    }
    if (approval) resolvingApprovals.delete(approval.id);
    sentDrafts.delete(event.requestId);
  }
};

const connect = (): void => {
  client?.stop();
  client = new RemoteClient(handleEvent, (state, message) => {
    connectionState.value = state;
    connectionMessage.value = message;
  });
  client.start();
};
const sendCommand = (command: MobileCommand): void => {
  pendingCommands.set(command.requestId, command.type);
  try { client?.send(command); }
  catch (reason) {
    pendingCommands.delete(command.requestId);
    throw reason;
  }
};
const send = (): void => {
  if (!canSend.value) return;
  const value = draft.value.trim();
  const requestId = crypto.randomUUID();
  draft.value = "";
  sentDrafts.set(requestId, value);
  try { sendCommand({ type: "turn.send", requestId, text: value }); }
  catch (reason) { sentDrafts.delete(requestId); draft.value = value; error.value = reason instanceof Error ? reason.message : String(reason); }
};
const newThread = (): void => { if (!desktopReady.value || threadBusy.value) return; try { sendCommand({ type: "thread.new", requestId: crypto.randomUUID() }); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } };
const openThread = (threadId: string): void => { if (!desktopReady.value || threadBusy.value) return; sessionMenuOpen.value = false; try { sendCommand({ type: "thread.open", requestId: crypto.randomUUID(), threadId }); } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); } };
const openSessionMenu = (): void => { sessionMenuOpen.value = true; };
const resolveApproval = (item: Extract<MobileItem, { kind: "approval" }>, decision: "accept" | "decline"): void => {
  if (resolvingApprovals.has(item.id)) return;
  const requestId = crypto.randomUUID();
  resolvingApprovals.add(item.id);
  approvalResolutions.set(requestId, item);
  snapshot.value.items = snapshot.value.items.filter((candidate) => candidate.id !== item.id);
  try { sendCommand({ type: "approval.resolve", requestId, approvalId: item.id, version: item.version, decision }); }
  catch (reason) {
    resolvingApprovals.delete(item.id);
    approvalResolutions.delete(requestId);
    snapshot.value.items.push(item);
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
};
onMounted(connect);
onBeforeUnmount(() => client?.stop());
</script>

<template>
  <NConfigProvider :theme="darkTheme">
  <main class="app-shell">
    <header><div><h1>{{ snapshot.activeThreadTitle }}</h1><p><span class="status-dot" :class="statusClass" />{{ connectionMessage }} · {{ snapshot.codexMessage }}</p></div><div class="session-menu"><button class="session-button" aria-label="打开会话列表" @click="sessionMenuOpen = !sessionMenuOpen">会话</button><aside v-if="sessionMenuOpen" aria-label="最近会话"><div class="drawer-header"><strong>最近会话</strong></div><div class="drawer-body"><div v-if="!snapshot.threads.length" class="drawer-empty">暂无会话</div><button v-for="thread in snapshot.threads" :key="thread.id" class="thread-row" :class="{ active: thread.id === snapshot.activeThreadId }" :disabled="threadBusy" @click="openThread(thread.id)"><strong>{{ thread.title }}</strong><span>{{ thread.preview }}</span></button></div><div class="drawer-actions"><NButton type="primary" block :disabled="!desktopReady || threadBusy" :loading="threadBusy" @click="newThread(); sessionMenuOpen = false">新建会话</NButton></div></aside></div></header>
    <section ref="scrollContainer" class="conversation" @scroll="handleScroll">
      <NAlert v-if="error" closable type="warning" @close="error = ''">{{ error }}</NAlert>
      <div v-if="!snapshot.activeThreadId" class="empty-state"><h2>选择一个会话</h2><p>可以继续最近的会话，也可以新建会话。</p></div>
      <article v-for="item in snapshot.items" :key="item.id" class="message" :class="item.kind">
        <div v-if="item.kind === 'user'" class="bubble">{{ item.text }}</div>
        <div v-else-if="item.kind === 'agent'" class="markdown" v-html="markdown(item.id, item.markdown)" />
        <details v-else-if="item.kind === 'activity'" class="activity-card"><summary><span>{{ item.title }}</span><small>{{ item.status === 'running' ? '进行中' : item.status === 'failed' ? '失败' : '完成' }}</small></summary><p>{{ item.summary }}</p><pre v-if="item.detail">{{ item.detail }}</pre></details>
        <section v-else class="approval-card"><strong>{{ item.title }}</strong><p>{{ item.summary }}</p><div><NButton :disabled="resolvingApprovals.has(item.id)" @click="resolveApproval(item, 'decline')">拒绝</NButton><NButton type="primary" :loading="resolvingApprovals.has(item.id)" @click="resolveApproval(item, 'accept')">仅本次同意</NButton></div></section>
      </article>
      <NSpin v-if="snapshot.turnStatus === 'running'" size="small"><span class="running-label">Codex 正在处理…</span></NSpin>
      <div class="bottom-spacer" />
    </section>
    <button v-if="!followTail" class="latest-button" @click="scrollLatest">回到最新<span v-if="unread"> · {{ unread }}</span></button>
    <footer><div class="footer-actions"><NButton size="small" secondary :disabled="!desktopReady || threadBusy" @click="newThread">新会话</NButton><NButton size="small" secondary @click="openSessionMenu">切换会话</NButton></div><div class="composer"><NInput v-model:value="draft" type="textarea" :autosize="{ minRows: 1, maxRows: 5 }" maxlength="20000" placeholder="输入消息…" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send" /><NButton type="primary" :disabled="!canSend" :loading="sending" @click="send">{{ snapshot.turnStatus === 'running' ? '追加' : '发送' }}</NButton></div></footer>
  </main>
  </NConfigProvider>
</template>
