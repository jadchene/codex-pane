<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { NButton, NEmpty, NIcon, NInput, NList, NListItem, NSpin, NTag, NText, NTime } from "naive-ui";
import { AddOutline, SyncOutline } from "@vicons/ionicons5";
import type { ThreadSummary } from "../types";

const props = withDefaults(defineProps<{
  threads: ThreadSummary[];
  activeThreadId: string | null;
  showAll: boolean;
  currentCwd: string;
  loading?: boolean;
  showNew?: boolean;
  showResumeButton?: boolean;
  searchPlaceholder?: string;
  showAllLabel?: string;
  currentOnlyLabel?: string;
  unreadThreadIds?: string[];
  workingThreadIds?: string[];
}>(), {
  loading: false,
  showNew: false,
  showResumeButton: false,
  searchPlaceholder: "搜索会话",
  showAllLabel: "全部",
  currentOnlyLabel: "当前目录",
  unreadThreadIds: () => [],
  workingThreadIds: () => []
});
const emit = defineEmits<{
  search: [value: string];
  scope: [showAll: boolean, search: string];
  resume: [threadId: string];
  newSession: [];
}>();
const search = ref("");
const searchInput = ref<{ focus: () => void } | null>(null);
const noSpellcheckInputProps = { spellcheck: false, autocorrect: "off", autocapitalize: "off" } as const;
let timer: ReturnType<typeof setTimeout> | null = null;

const focusSearch = async (): Promise<void> => {
  await nextTick();
  searchInput.value?.focus();
};

watch(search, (value) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => emit("search", value), 250);
});
onUnmounted(() => { if (timer) clearTimeout(timer); });
defineExpose({ focusSearch });
</script>

<template>
  <div class="session-list-panel">
    <NButton v-if="showNew" type="primary" secondary class="session-new-button" @click="emit('newSession')">
      <template #icon><NIcon :component="AddOutline" /></template>
      新建会话
    </NButton>
    <div class="session-search-sticky">
      <div class="session-search-row">
        <NInput ref="searchInput" v-model:value="search" clearable :input-props="noSpellcheckInputProps" :placeholder="searchPlaceholder" aria-label="搜索历史会话" />
        <NButton secondary class="session-scope-button" :disabled="showAll && !currentCwd" @click="emit('scope', !showAll, search)">{{ showAll ? currentOnlyLabel : showAllLabel }}</NButton>
      </div>
      <NText depth="3" class="session-scope-label">{{ showAll ? "所有工作目录" : `当前目录：${currentCwd || "未设置"}` }}</NText>
    </div>
    <NSpin :show="loading" class="session-list-spin">
      <div class="session-list-scroll">
        <NEmpty v-if="threads.length === 0" description="没有会话" />
        <NList v-else hoverable clickable class="session-list">
          <NListItem
            v-for="thread in threads"
            :key="thread.id"
            class="session-item"
            :class="{ 'session-item-active': thread.id === activeThreadId }"
            @click="emit('resume', thread.id)"
          >
            <div class="session-item-body">
              <div class="session-title-row">
                <NIcon v-if="workingThreadIds.includes(thread.id)" :component="SyncOutline" class="session-working-icon" aria-label="正在工作" />
                <span
                  v-if="!workingThreadIds.includes(thread.id) && unreadThreadIds.includes(thread.id) && thread.id !== activeThreadId"
                  class="session-unread-dot"
                  aria-label="有未读内容"
                />
                <strong class="session-title">{{ thread.name || thread.preview.slice(0, 80) || "未命名会话" }}</strong>
                <NTag v-if="thread.id === activeThreadId" size="small" type="success">当前</NTag>
              </div>
              <div class="session-meta">
                <NText depth="3" class="session-cwd">{{ thread.cwd || "—" }}</NText>
                <span class="session-meta-dot">·</span>
                <NTime class="session-time" :time="thread.updatedAt * 1000" type="relative" />
              </div>
            </div>
            <template v-if="showResumeButton" #suffix><NButton size="small" secondary class="session-resume-button" @click.stop="emit('resume', thread.id)">恢复</NButton></template>
          </NListItem>
        </NList>
      </div>
    </NSpin>
  </div>
</template>
