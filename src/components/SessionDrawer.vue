<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { NButton, NEmpty, NInput, NList, NListItem, NTag, NText, NTime } from "naive-ui";
import { CloseOutline } from "@vicons/ionicons5";
import type { PaneState, ThreadSummary } from "../types";

const props = defineProps<{ show: boolean; pane: PaneState | null; threads: ThreadSummary[]; showAll: boolean; currentCwd: string }>();
const emit = defineEmits<{
  "update:show": [value: boolean];
  search: [value: string];
  scope: [showAll: boolean, search: string];
  resume: [threadId: string];
}>();
const search = ref("");
const searchInput = ref<{ focus: () => void } | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

const visiblePreview = (thread: ThreadSummary): string => {
  const preview = thread.preview.trim();
  const title = thread.name?.trim() ?? "";
  return !preview || preview === title || title && preview.startsWith(title) ? "" : preview;
};
watch(search, (value) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => emit("search", value), 250);
});
watch(() => props.show, (show) => {
  if (show) {
    search.value = "";
    void nextTick(() => searchInput.value?.focus());
  }
});
onUnmounted(() => { if (timer) clearTimeout(timer); });
</script>

<template>
  <Teleport v-if="show && pane" :to="`[data-pane-id='${pane.id}']`">
    <section class="session-pane-page" role="region" aria-label="恢复会话" @keydown.esc.stop="emit('update:show', false)">
      <header class="session-pane-header"><strong>恢复会话</strong><NButton quaternary circle size="small" aria-label="关闭恢复会话" @click="emit('update:show', false)"><template #icon><CloseOutline /></template></NButton></header>
      <div class="session-search-sticky">
        <div class="session-search-row">
          <NInput ref="searchInput" v-model:value="search" clearable placeholder="按标题或内容搜索历史会话" aria-label="搜索历史会话" />
          <NButton secondary class="session-scope-button" :disabled="showAll && !currentCwd" @click="emit('scope', !showAll, search)">{{ showAll ? "仅当前目录" : "显示全部" }}</NButton>
        </div>
        <NText depth="3" class="session-scope-label">{{ showAll ? "所有工作目录" : `当前目录：${currentCwd}` }}</NText>
      </div>
      <div class="session-list-scroll">
        <NEmpty v-if="threads.length === 0" description="没有找到可恢复的会话" />
        <NList v-else hoverable clickable class="session-list">
          <NListItem v-for="thread in threads" :key="thread.id" class="session-item" @click="emit('resume', thread.id)">
            <div class="session-item-body">
              <div class="session-title-row">
                <strong class="session-title">{{ thread.name || thread.preview.slice(0, 80) || "未命名会话" }}</strong>
                <NTag v-if="thread.id === pane?.threadId" size="small" type="success">当前</NTag>
              </div>
              <NText v-if="visiblePreview(thread)" depth="3" class="session-preview">{{ visiblePreview(thread) }}</NText>
              <div class="session-meta">
                <NText depth="3" class="session-cwd">{{ thread.cwd || "—" }}</NText>
                <span class="session-meta-dot">·</span>
                <NTime class="session-time" :time="thread.updatedAt * 1000" type="relative" />
              </div>
            </div>
            <template #suffix><NButton size="small" secondary class="session-resume-button" @click.stop="emit('resume', thread.id)">恢复</NButton></template>
          </NListItem>
        </NList>
      </div>
    </section>
  </Teleport>
</template>
