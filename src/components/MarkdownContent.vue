<script setup lang="ts">
import { computed } from "vue";
import { useDialog } from "naive-ui";
import DOMPurify from "dompurify";
import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import "highlight.js/styles/atom-one-dark.css";

const props = defineProps<{ source: string }>();
const dialog = useDialog();

marked.setOptions({ gfm: true, breaks: true });
Object.entries({ bash, css, diff, java, javascript, json, powershell, python, rust, sql, typescript, xml }).forEach(([name, language]) => hljs.registerLanguage(name, language));
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang?.match(/^[\w-]+/)?.[0];
      const highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
      return `<pre><code class="hljs${language ? ` language-${language}` : ""}">${highlighted}</code></pre>`;
    }
  }
});

const html = computed(() => DOMPurify.sanitize(marked.parse(props.source, { async: false }) as string, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
  FORBID_ATTR: ["style", "onerror", "onclick", "onload"]
}));

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
  <div class="markdown-content" @click="handleClick" v-html="html" />
</template>
