<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { NAlert, NButton, NDropdown, NIcon, NInput, NSelect, NTag, NText, NTooltip } from "naive-ui";
import { AddOutline, AttachOutline, DocumentTextOutline, LinkOutline, PauseOutline, SendOutline } from "@vicons/ionicons5";
import type { PaneState, PendingServerRequest, UiItem } from "../types";
import ApprovalCenter from "./ApprovalCenter.vue";
import ItemCard from "./ItemCard.vue";
import VirtualList from "./VirtualList.vue";

const props = defineProps<{
  pane: PaneState;
  defaultCwd: string;
  models: Array<{ label: string; value: string; efforts: string[]; inputModalities: string[]; defaultEffort: string | null }>;
  focused: boolean;
  pendingRequests: PendingServerRequest[];
  approvalResolving: boolean;
  rateLimitLabels: string[];
  approvalReviewer?: string | null;
  commandShellPath?: string;
  mcpGatewayAdaptation?: boolean;
}>();
const emit = defineEmits<{
  send: [];
  interrupt: [];
  newThread: [];
  openSessions: [];
  chooseAttachments: [];
  openSkills: [];
  pasteAttachments: [paths: string[]];
  slashCommand: [command: string];
  removeAttachment: [id: string];
  removeReference: [id: string];
  resolve: [request: PendingServerRequest, result?: unknown, error?: { code: number; message: string }];
  scrollState: [top: number, followTail: boolean];
  loadOlder: [];
  activate: [];
  itemAction: [action: { type: "switchAgent"; threadId: string } | { type: "stopBackgroundProcess"; processId: string } | { type: "stopAllBackgroundProcesses" } | { type: "switchPermissionProfile"; profileId: string }];
}>();

type ConversationScroller = { $el: HTMLElement; scrollToBottom: () => void; scrollToPosition: (position: number) => void };

const output = ref<ConversationScroller | null>(null);
const composer = ref<{ focus: () => void } | null>(null);
const restoredThreadId = ref<string | null>(null);
const slashIndex = ref(0);
const effortOptions = computed(() => props.models.find((model) => model.value === props.pane.model)?.efforts.map((effort) => ({ label: effort, value: effort })) ?? []);
const modelSupportsImage = computed(() => {
  const model = props.models.find((candidate) => candidate.value === props.pane.model);
  return !model || model.inputModalities.length === 0 || model.inputModalities.includes("image");
});
const slashOptions = [
  { label: "/agents", description: "查看并切换子代理", key: "agents" },
  { label: "/compact", description: "压缩上下文", key: "compact" },
  { label: "/cwd", description: "切换工作目录", key: "cwd" },
  { label: "/kill-processes", description: "关闭所有后台进程", key: "kill-processes" },
  { label: "/mcp", description: "查看 MCP 状态", key: "mcp" },
  { label: "/new", description: "新建会话", key: "new" },
  { label: "/permissions", description: "切换权限模式", key: "permissions" },
  { label: "/processes", description: "查看后台进程", key: "processes" },
  { label: "/resume", description: "恢复历史会话", key: "resume" },
  { label: "/review", description: "审查未提交更改", key: "review" },
  { label: "/skills", description: "查看可用技能", key: "skills" },
  { label: "/status", description: "查看当前状态", key: "status" }
];
const slashQuery = computed(() => props.pane.draft.trim().match(/^\/([a-z]*)$/i)?.[1]?.toLowerCase() ?? null);
const filteredSlashOptions = computed(() => slashQuery.value === null ? [] : slashOptions.filter((option) => option.key.startsWith(slashQuery.value!)));
const skillQuery = computed(() => props.pane.draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1]?.toLocaleLowerCase() ?? null);
const filteredSkills = computed(() => skillQuery.value === null ? [] : props.pane.skills.filter((skill) => skill.name.toLocaleLowerCase().includes(skillQuery.value!)));
const composerMenuMode = computed<"slash" | "skill" | null>(() => slashQuery.value !== null ? "slash" : skillQuery.value !== null ? "skill" : null);
const composerMenuVisible = computed(() => composerMenuMode.value === "slash" ? filteredSlashOptions.value.length > 0 : composerMenuMode.value === "skill" && filteredSkills.value.length > 0);
const effectiveCwd = computed(() => props.pane.cwd || props.defaultCwd || "未设置工作目录");
const contextLabel = computed(() => {
  const remaining = props.pane.contextRemainingPercent;
  return `上下文 ${typeof remaining === "number" ? 100 - Math.min(100, Math.max(0, remaining)) : 0}%`;
});
const autoReviewLabel = computed(() => {
  const review = props.pane.approvalReviews?.at(-1);
  if (review?.status === "inProgress") return "自动审查中…";
  if (review?.status === "approved") return "自动审查：已允许";
  if (review?.status === "denied") return "自动审查：未通过";
  if (review?.status === "timedOut") return "自动审查：已超时";
  if (review?.status === "aborted") return "自动审查：已中止";
  if (props.pane.strictReviewRequired) return "自动审查：后续命令均需复核";
  if (props.approvalReviewer === "auto_review" || props.approvalReviewer === "guardian_subagent") return "自动审查已启用";
  return "";
});
const modelSelectLabels = computed(() => ["模型", ...props.models.map((model) => model.label)]);
const effortSelectLabels = computed(() => ["推理", ...effortOptions.value.map((option) => option.label)]);
const composerDropdownOptions = computed(() => {
  const options = composerMenuMode.value === "slash"
    ? filteredSlashOptions.value.map((option) => ({ key: `slash:${option.key}`, label: `${option.label}  ${option.description}` }))
    : filteredSkills.value.map((skill) => ({ key: `skill:${skill.name}`, label: skill.name }));
  return options.map((option, index) => ({ ...option, props: { class: index === slashIndex.value ? "slash-option-active" : "" } }));
});
const composerMenuProps = () => ({ class: "composer-options-menu", style: "max-height: min(320px, calc(100vh - 180px));" });
const activeComposerOptions = computed(() => composerMenuMode.value === "slash" ? filteredSlashOptions.value : filteredSkills.value);
const itemKey = (item: UiItem): string => `${item.turnId}:${item.id}`;
const estimateItemSize = (item: UiItem): number => {
  if (item.type === "userMessage") return 72;
  if (item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan") {
    const text = typeof item.data.text === "string" ? item.data.text : item.streamText;
    return Math.min(560, 72 + Math.ceil(text.length / 44) * 20);
  }
  if (item.type === "fileChange") return 180;
  return 124;
};
const outputElement = (): HTMLElement | null => output.value?.$el ?? null;

const focusComposer = async (): Promise<void> => {
  await nextTick();
  composer.value?.focus();
};
const scrollToBottom = async (): Promise<void> => {
  if (!props.pane.followTail) return;
  await nextTick();
  const element = outputElement();
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  emit("scrollState", element.scrollTop, true);
};
const forceScrollToBottom = async (): Promise<void> => {
  await nextTick();
  const element = outputElement();
  if (!element) return;
  element.scrollTop = element.scrollHeight;
  emit("scrollState", element.scrollTop, true);
};
const handleOutputScroll = (event: Event): void => {
  const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : outputElement();
  if (!element) return;
  const followTail = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  emit("scrollState", element.scrollTop, followTail);
  if (element.scrollTop < 240) emit("loadOlder");
};
const selectSlashCommand = (command: string): void => {
  props.pane.draft = "";
  slashIndex.value = 0;
  if (command === "new") emit("newThread");
  else if (command === "resume") emit("openSessions");
  else emit("slashCommand", command);
  void focusComposer();
};
const selectSkill = (name: string): void => {
  props.pane.draft = props.pane.draft.replace(/(^|\s)@[^\s@]*$/, `$1@${name} `);
  slashIndex.value = 0;
  void focusComposer();
};
const selectComposerOption = (key: string): void => {
  if (key.startsWith("slash:")) selectSlashCommand(key.slice(6));
  else if (key.startsWith("skill:")) selectSkill(key.slice(6));
};
const completeSlash = (): void => {
  const option = filteredSlashOptions.value[slashIndex.value] ?? filteredSlashOptions.value[0];
  if (option) props.pane.draft = option.label;
};
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === "ArrowDown" && props.pane.draft.length === 0 && !event.isComposing) {
    event.preventDefault();
    void forceScrollToBottom();
    return;
  }
  if (composerMenuVisible.value && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    const option = activeComposerOptions.value[slashIndex.value] ?? activeComposerOptions.value[0];
    if (composerMenuMode.value === "slash" && option && "key" in option) selectSlashCommand(option.key);
    else if (composerMenuMode.value === "skill" && option && "name" in option) selectSkill(option.name);
    return;
  }
  if (composerMenuVisible.value && ["ArrowDown", "ArrowUp", "Tab"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowDown") slashIndex.value = (slashIndex.value + 1) % activeComposerOptions.value.length;
    else if (event.key === "ArrowUp") slashIndex.value = (slashIndex.value - 1 + activeComposerOptions.value.length) % activeComposerOptions.value.length;
    else if (composerMenuMode.value === "slash") completeSlash();
    else {
      const skill = filteredSkills.value[slashIndex.value] ?? filteredSkills.value[0];
      if (skill) selectSkill(skill.name);
    }
    return;
  }
  if (event.key === "Escape" && composerMenuVisible.value) {
    props.pane.draft = composerMenuMode.value === "slash" ? "" : props.pane.draft.replace(/(^|\s)@[^\s@]*$/, "$1");
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    const command = props.pane.draft.trim().match(/^\/(new|resume|cwd|status|compact|review|mcp|skills|agents|permissions|processes|kill-processes)$/i)?.[1]?.toLowerCase();
    if (command) selectSlashCommand(command);
    else emit("send");
  }
};
const handlePaste = (event: ClipboardEvent): void => {
  const clipboardData = event.clipboardData;
  const files = [...(clipboardData?.files ?? [])];
  const hasBinaryItem = files.length > 0 || [...(clipboardData?.items ?? [])].some((item) => item.kind === "file");
  if (hasBinaryItem) {
    event.preventDefault();
    const directPaths = [
      ...files.map((file) => (file as File & { path?: string }).path ?? ""),
      ...(window.codexPane?.resolveFilePaths?.(files) ?? [])
    ].filter(Boolean);
    const uriPaths = (clipboardData?.getData("text/uri-list") ?? "").split(/\r?\n/).filter((line) => line.startsWith("file://")).map((line) => {
      try {
        return decodeURIComponent(new URL(line).pathname).replace(/^\/([a-z]:)/i, "$1").replaceAll("/", "\\");
      } catch {
        return "";
      }
    }).filter(Boolean);
    emit("pasteAttachments", [...new Set([...directPaths, ...uriPaths])]);
  }
};
const openSlashMenu = (): void => {
  props.pane.draft = "/";
  slashIndex.value = 0;
  void focusComposer();
};
const openSkillMenu = (): void => {
  if (!/(^|\s)@[^\s@]*$/.test(props.pane.draft)) {
    props.pane.draft = props.pane.draft && !/\s$/.test(props.pane.draft) ? `${props.pane.draft} @` : `${props.pane.draft}@`;
  }
  slashIndex.value = 0;
  void focusComposer();
};
const activatePane = (event: MouseEvent): void => {
  emit("activate");
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".inline-approval, .n-select, .n-base-selection, button, input, textarea, select, [contenteditable], [role='button'], [role='option'], [role='combobox']")) return;
  if (window.getSelection()?.toString()) return;
  void focusComposer();
};
const hasFocusedInteractiveControl = (): boolean => document.activeElement instanceof Element
  && !!document.activeElement.closest(".inline-approval, .n-select, .n-base-selection, button, input:not(textarea), select, [contenteditable], [role='button'], [role='option'], [role='combobox']");

watch(() => {
  const last = props.pane.items.at(-1);
  return [props.pane.items.length, last?.id, last?.streamText.length, last?.status] as const;
}, scrollToBottom);
watch(() => props.pendingRequests.length, (count, previous) => {
  if (previous > count) void focusComposer();
});
watch(() => props.focused, (focused) => {
  if (focused && props.pendingRequests.length === 0 && !hasFocusedInteractiveControl() && !window.getSelection()?.toString()) void focusComposer();
});
watch(slashQuery, () => { slashIndex.value = 0; });
watch(skillQuery, (query, previous) => {
  if (query !== null && previous === null) emit("openSkills");
  slashIndex.value = 0;
});
watch(
  () => [props.pane.threadId, props.pane.items.length > 0, props.pane.followTail] as const,
  async ([threadId, hasItems, followTail]) => {
    if (followTail || !hasItems || restoredThreadId.value === threadId) return;
    await nextTick();
    const element = outputElement();
    if (!element) return;
    element.scrollTop = Math.min(props.pane.scrollTop, Math.max(0, element.scrollHeight - element.clientHeight));
    restoredThreadId.value = threadId;
  },
  { immediate: true }
);
watch(() => props.pane.model, (model) => {
  const option = props.models.find((candidate) => candidate.value === model);
  if (!option || props.pane.effort && option.efforts.includes(props.pane.effort)) return;
  props.pane.effort = option.defaultEffort ?? option.efforts[0] ?? null;
});
onMounted(async () => {
  await nextTick();
  if (props.pane.followTail) {
    const element = outputElement();
    if (element) element.scrollTop = element.scrollHeight;
  }
});
defineExpose({ focusComposer });
</script>

<template>
  <section class="pane" :class="{ 'pane-focused': focused }" :data-pane-id="pane.id" :aria-label="pane.title" @focusin="emit('activate')" @click="activatePane">
    <header class="pane-header">
      <div class="pane-title-wrap">
        <span v-if="pane.unread" class="unread-dot" aria-label="有新内容" />
        <strong class="pane-title">{{ pane.title || "新会话" }}</strong>
      </div>
      <NTag v-if="pane.status === 'interrupting' || pane.status === 'error'" size="small" :type="pane.status === 'error' ? 'error' : 'warning'">
        {{ pane.status === "interrupting" ? "正在停止" : "需要处理" }}
      </NTag>
    </header>

    <VirtualList ref="output" class="pane-output" :items="pane.items" :item-key="itemKey" :estimate-size="estimateItemSize" :min-item-size="56" :buffer="160" :follow-tail="pane.followTail" @scroll="handleOutputScroll">
      <template #before><div v-if="pane.historyLoading" class="history-loading">正在加载更早内容…</div></template>
      <template #default="{ item }"><div class="conversation-item"><ItemCard :item="item" :command-shell-path="commandShellPath" :mcp-gateway-adaptation="mcpGatewayAdaptation" @action="emit('itemAction', $event)" /></div></template>
      <template #empty><div class="empty-conversation"><NText depth="3">输入消息开始会话</NText></div></template>
    </VirtualList>

    <NAlert v-if="pane.error" type="error" closable class="pane-error" @close="pane.error = null">{{ pane.error }}</NAlert>

    <div class="composer">
      <ApprovalCenter
        :requests="pendingRequests"
        :show="pendingRequests.length > 0"
        :pane-id="null"
        :resolving="approvalResolving"
        @update:show="undefined"
        @resolve="(request, result, error) => emit('resolve', request, result, error)"
      />

      <div v-if="pane.attachments.length || pane.references.length" class="attachment-list">
        <div v-for="attachment in pane.attachments" :key="attachment.id" class="attachment-chip">
          <img v-if="attachment.kind === 'local'" :src="attachment.url" alt="" />
          <NIcon v-else :component="LinkOutline" size="20" aria-label="远程图片地址" />
          <span>{{ attachment.name }}</span>
          <NButton quaternary circle size="tiny" :aria-label="`移除 ${attachment.name}`" @click="emit('removeAttachment', attachment.id)">×</NButton>
        </div>
        <div v-for="reference in pane.references" :key="reference.id" class="attachment-chip">
          <NIcon :component="DocumentTextOutline" size="20" aria-label="文件" />
          <span>{{ reference.name }}</span>
          <NButton quaternary circle size="tiny" :aria-label="`移除 ${reference.name}`" @click="emit('removeReference', reference.id)">×</NButton>
        </div>
      </div>

      <NDropdown trigger="manual" placement="top-start" scrollable :show="composerMenuVisible" :options="composerDropdownOptions" :menu-props="composerMenuProps" @select="selectComposerOption">
        <NInput ref="composer" v-model:value="pane.draft" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" placeholder="发送消息，输入 / 查看命令，输入 @ 使用 Skill" @keydown="handleKeydown" @paste="handlePaste" />
      </NDropdown>

      <div class="composer-actions">
        <div class="composer-tools">
          <NTooltip><template #trigger><NButton quaternary circle size="small" aria-label="斜杠命令" @click="openSlashMenu">/</NButton></template>斜杠命令</NTooltip>
          <NTooltip><template #trigger><NButton quaternary circle size="small" aria-label="选择 Skill" @click="openSkillMenu">@</NButton></template>选择 Skill</NTooltip>
          <NTooltip><template #trigger><NButton quaternary circle size="small" aria-label="添加附件" @click="emit('chooseAttachments')"><template #icon><NIcon :component="AttachOutline" /></template></NButton></template>添加附件</NTooltip>
          <span class="cwd-text">{{ effectiveCwd }}</span>
        </div>
        <div class="composer-submit">
          <NButton v-if="pane.activeTurnId" size="small" secondary @click="emit('send')"><template #icon><NIcon :component="AddOutline" /></template>追加</NButton>
          <NButton v-if="pane.activeTurnId" size="small" type="error" secondary @click="emit('interrupt')"><template #icon><NIcon :component="PauseOutline" /></template>停止</NButton>
          <NButton v-else size="small" type="primary" :disabled="(!pane.draft.trim() && pane.attachments.length === 0 && pane.references.length === 0) || !modelSupportsImage && pane.attachments.length > 0" @click="emit('send')"><template #icon><NIcon :component="SendOutline" /></template>发送</NButton>
        </div>
      </div>

      <footer class="status-line">
        <div class="content-fit-select model-select-fit">
          <span class="select-width-sizer" aria-hidden="true"><span v-for="label in modelSelectLabels" :key="label">{{ label }}</span></span>
          <NSelect v-model:value="pane.model" class="compact-select model-select" size="tiny" :options="models" placeholder="模型" :consistent-menu-width="false" :menu-props="{ class: 'content-fit-select-menu' }" @mousedown.stop @click.stop />
        </div>
        <div class="content-fit-select effort-select-fit">
          <span class="select-width-sizer" aria-hidden="true"><span v-for="label in effortSelectLabels" :key="label">{{ label }}</span></span>
          <NSelect v-model:value="pane.effort" class="compact-select effort-select" size="tiny" :options="effortOptions" placeholder="推理" :consistent-menu-width="false" :menu-props="{ class: 'content-fit-select-menu' }" @mousedown.stop @click.stop />
        </div>
        <span v-if="pane.status === 'running' || pane.status === 'starting'" class="working-indicator" role="status">Working<span class="working-dots">...</span></span>
        <span v-if="autoReviewLabel" class="auto-review-indicator" role="status">{{ autoReviewLabel }}</span>
        <span v-if="pane.activeFlags?.includes('waitingOnApproval')">等待操作确认</span>
        <span v-else-if="pane.activeFlags?.includes('waitingOnUserInput')">等待你的选择</span>
        <span>{{ contextLabel }}</span>
        <span v-for="label in rateLimitLabels" :key="label">{{ label }}</span>
      </footer>
    </div>
  </section>
</template>
