<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useDialog } from "naive-ui";
import "highlight.js/styles/atom-one-dark.css";
import { getCachedMarkdown, renderCachedMarkdown } from "../markdown";

const props = withDefaults(defineProps<{ source: string; streaming?: boolean }>(), { streaming: false });
const dialog = useDialog();

const html = ref("");
let idleTask: number | null = null;
let fallbackTask: ReturnType<typeof setTimeout> | null = null;

const cancelRender = (): void => {
  if (idleTask !== null) window.cancelIdleCallback(idleTask);
  if (fallbackTask !== null) clearTimeout(fallbackTask);
  idleTask = null;
  fallbackTask = null;
};
const scheduleRender = (): void => {
  cancelRender();
  if (props.streaming) {
    html.value = "";
    return;
  }
  const source = props.source;
  const cached = getCachedMarkdown(source);
  if (cached !== null) {
    html.value = cached;
    return;
  }
  html.value = "";
  const render = (): void => {
    idleTask = null;
    fallbackTask = null;
    if (!props.streaming && props.source === source) html.value = renderCachedMarkdown(source);
  };
  if (typeof window.requestIdleCallback === "function") idleTask = window.requestIdleCallback(render);
  else fallbackTask = setTimeout(render, 0);
};

watch(() => [props.source, props.streaming] as const, scheduleRender, { immediate: true });
onBeforeUnmount(cancelRender);

const handleClick = (event: MouseEvent): void => {
  const target = event.target instanceof Element ? event.target.closest("a") : null;
  if (!target) return;
  event.preventDefault();
  const href = target.getAttribute("href");
  if (!href) return;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:") {
      dialog.warning({ title: "无法打开链接", content: "Codex Pane 只允许通过系统浏览器打开 HTTPS 链接。", positiveText: "知道了" });
      return;
    }
    void window.codexPane.openExternal(url.toString());
  } catch {
    dialog.warning({ title: "无法打开链接", content: "这个链接格式无效。", positiveText: "知道了" });
  }
};
</script>

<template>
  <pre v-if="streaming || !html" class="markdown-content markdown-streaming">{{ source }}</pre>
  <div v-else class="markdown-content" @click="handleClick" v-html="html" />
</template>

<style scoped>
.markdown-streaming { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
</style>
