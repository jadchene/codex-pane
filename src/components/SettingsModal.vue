<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NAutoComplete, NButton, NCard, NColorPicker, NDescriptions, NDescriptionsItem, NDivider, NForm, NFormItem, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSpace, NSwitch, NTag, NText } from "naive-ui";
import { useWorkspaceStore } from "../stores/workspace";
import type { AppearanceSettings, ThemeMode } from "../types";

const props = withDefaults(defineProps<{ show: boolean; commandShellPath?: string }>(), {
  commandShellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
});
const emit = defineEmits<{ "update:show": [value: boolean]; "update:commandShellPath": [value: string] }>();
const store = useWorkspaceStore();

const updateAppearance = (appearance: Partial<AppearanceSettings>): void => store.updateAppearance(appearance);

const theme = computed({ get: () => store.state.appearance.theme, set: (value: ThemeMode) => updateAppearance({ theme: value }) });
const fontFamily = computed({ get: () => store.state.appearance.fontFamily, set: (value: string) => updateAppearance({ fontFamily: value }) });
const fontSize = computed({
  get: () => store.state.appearance.fontSize,
  set: (value: number | null) => updateAppearance({ fontSize: Math.min(20, Math.max(12, value ?? 14)) })
});
const accentColor = computed({ get: () => store.state.appearance.accentColor, set: (value: string) => updateAppearance({ accentColor: value }) });
const commandShellPath = computed({ get: () => props.commandShellPath, set: (value: string) => emit("update:commandShellPath", value) });
const mcpGatewayAdaptation = computed({ get: () => store.state.appearance.mcpGatewayAdaptation, set: (value: boolean) => updateAppearance({ mcpGatewayAdaptation: value }) });
const systemFonts = ref<string[]>([]);
const fontListState = ref<"idle" | "loading" | "ready" | "unavailable" | "denied">("idle");
const fontOptions = computed(() => systemFonts.value.map((family) => ({ label: family, value: family })));
const display = (value: string | null | undefined): string => value || "—";
const loadSystemFonts = async (): Promise<void> => {
  if (fontListState.value === "loading" || fontListState.value === "ready") return;
  const queryLocalFonts = (window as typeof window & { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts;
  fontListState.value = "loading";
  try {
    const nativeFonts = queryLocalFonts ? await queryLocalFonts.call(window) : [];
    const browserFamilies = nativeFonts.map((font) => font.family.trim()).filter(Boolean);
    const systemFallback = browserFamilies.length ? [] : await window.codexPane.listSystemFonts?.() ?? [];
    systemFonts.value = [...new Set([...browserFamilies, ...systemFallback].map((family) => family.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
    fontListState.value = systemFonts.value.length ? "ready" : queryLocalFonts ? "unavailable" : "unavailable";
  } catch {
    try {
      systemFonts.value = await window.codexPane.listSystemFonts?.() ?? [];
      fontListState.value = systemFonts.value.length ? "ready" : "denied";
    } catch {
      fontListState.value = queryLocalFonts ? "denied" : "unavailable";
    }
  }
};
watch(() => props.show, (show) => { if (show) void loadSystemFonts(); }, { immediate: true });
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="设置"
    closable
    class="settings-modal"
    :style="{ width: 'min(780px, calc(100vw - 48px))', height: 'min(720px, calc(100vh - 96px))', maxHeight: 'calc(100vh - 96px)' }"
    content-style="min-height: 0; overflow: auto; padding-right: 18px;"
    :bordered="false"
    @update:show="emit('update:show', $event)"
  >
    <NSpace vertical :size="18">
      <section class="settings-section">
        <div class="settings-section-heading"><NText strong>外观</NText><NText depth="3">更改会立即应用到整个窗口。</NText></div>
        <NForm label-placement="left" label-width="148" class="settings-form">
          <NFormItem label="主题">
            <NRadioGroup v-model:value="theme" name="appearance-theme"><NRadioButton value="dark">纯黑</NRadioButton><NRadioButton value="light">纯白</NRadioButton></NRadioGroup>
          </NFormItem>
          <NFormItem label="界面字体">
            <div class="font-field">
              <NAutoComplete v-model:value="fontFamily" :options="fontOptions" clearable placeholder="输入或选择系统字体" />
              <NText v-if="fontListState === 'loading'" depth="3">正在读取系统字体…</NText>
              <NText v-else-if="fontListState === 'ready'" depth="3">已读取 {{ systemFonts.length }} 个字体系列，也可以直接输入。</NText>
              <NText v-else-if="fontListState === 'unavailable'" depth="3">当前环境不支持读取系统字体，请直接输入已安装字体名称。</NText>
              <NText v-else-if="fontListState === 'denied'" depth="3">未获得系统字体访问权限，请直接输入已安装字体名称。</NText>
            </div>
          </NFormItem>
          <NFormItem label="字号"><NInputNumber v-model:value="fontSize" :min="12" :max="20" :step="1" /></NFormItem>
          <NFormItem label="强调色"><NColorPicker v-model:value="accentColor" :modes="['hex']" :show-alpha="false" /></NFormItem>
        </NForm>
      </section>
      <NDivider />
      <section class="settings-section">
        <div class="settings-section-heading"><NText strong>Codex 运行环境</NText><NText depth="3">用于新会话和命令执行。</NText></div>
        <NForm label-placement="left" label-width="148" class="settings-form runtime-form">
          <NFormItem label="默认工作目录">
            <NCard size="small" embedded>
              <NSpace align="center" justify="space-between">
                <NText class="directory-value">{{ store.state.defaultCwd || "未设置，将使用应用目录" }}</NText>
                <NSpace :wrap="false">
                  <NButton type="primary" secondary @click="store.chooseDefaultDirectory">选择目录</NButton>
                  <NButton v-if="store.state.defaultCwd" secondary @click="store.clearDefaultDirectory">清空</NButton>
                </NSpace>
              </NSpace>
            </NCard>
          </NFormItem>
          <NFormItem label="PowerShell 7 路径">
            <NInput v-model:value="commandShellPath" clearable placeholder="C:\Program Files\PowerShell\7\pwsh.exe" />
          </NFormItem>
          <NFormItem label="MCP Gateway 适配">
            <NSwitch v-model:value="mcpGatewayAdaptation" />
          </NFormItem>
        </NForm>
      </section>
      <NDivider />
      <section class="settings-section">
        <div class="settings-section-heading"><NText strong>当前有效配置</NText><NText depth="3">只读</NText></div>
        <NDescriptions v-if="store.state.effectiveConfig" label-placement="left" bordered :column="2">
          <NDescriptionsItem label="默认模型">{{ display(store.state.effectiveConfig.model) }}</NDescriptionsItem>
          <NDescriptionsItem label="模型提供方">{{ display(store.state.effectiveConfig.modelProvider) }}</NDescriptionsItem>
          <NDescriptionsItem label="沙箱模式">{{ display(store.state.effectiveConfig.sandboxMode) }}</NDescriptionsItem>
          <NDescriptionsItem label="操作确认">{{ display(store.state.effectiveConfig.approvalPolicy) }}</NDescriptionsItem>
          <NDescriptionsItem label="确认评审方">{{ display(store.state.effectiveConfig.approvalReviewer) }}</NDescriptionsItem>
          <NDescriptionsItem label="推理强度">{{ display(store.state.effectiveConfig.reasoningEffort) }}</NDescriptionsItem>
          <NDescriptionsItem label="联网搜索">{{ display(store.state.effectiveConfig.webSearch) }}</NDescriptionsItem>
          <NDescriptionsItem label="服务层级">{{ display(store.state.effectiveConfig.serviceTier) }}</NDescriptionsItem>
        </NDescriptions>
        <NText v-else depth="3">Codex 尚未返回有效配置。</NText>
        <NSpace v-if="store.state.permissionProfiles.length" class="permission-profiles" align="center">
          <NText depth="3">权限配置</NText>
          <NTag v-for="profile in store.state.permissionProfiles" :key="profile.id" size="small" :type="profile.allowed ? 'success' : 'default'">{{ profile.id }} · {{ profile.allowed ? "可用" : "不可用" }}</NTag>
        </NSpace>
      </section>
    </NSpace>
    <template #footer><NSpace justify="end"><NButton type="primary" @click="emit('update:show', false)">完成</NButton></NSpace></template>
  </NModal>
</template>

<style scoped>
.settings-section { min-width: 0; }
.settings-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.settings-form { margin-top: 12px; }
.directory-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-field { display: grid; width: 100%; gap: 5px; }
.font-field .n-text { font-size: 12px; }
.runtime-form :deep(.n-card) { width: 100%; }
.settings-form :deep(.n-input-number) { width: 100%; }
.permission-profiles { margin-top: 12px; }
@media (max-width: 620px) {
  .settings-form :deep(.n-form-item) { grid-template-columns: 1fr !important; }
  .settings-form :deep(.n-form-item-label) { padding-bottom: 5px; text-align: left; }
}
</style>
