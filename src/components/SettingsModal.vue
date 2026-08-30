<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NAlert, NAutoComplete, NButton, NCard, NColorPicker, NDescriptions, NDescriptionsItem, NDivider, NForm, NFormItem, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSpace, NSwitch, NTag, NText } from "naive-ui";
import { useWorkspaceStore } from "../stores/workspace";
import type { AppearanceSettings, ThemeMode, WorkspaceMode } from "../types";

const props = withDefaults(defineProps<{ show: boolean; commandShellPath?: string }>(), {
  commandShellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
});
const emit = defineEmits<{ "update:show": [value: boolean]; "update:commandShellPath": [value: string]; "update:workspaceMode": [value: WorkspaceMode] }>();
const store = useWorkspaceStore();

const updateAppearance = (appearance: Partial<AppearanceSettings>): void => store.updateAppearance(appearance);

const workspaceMode = computed({ get: () => store.state.workspaceMode, set: (value: WorkspaceMode) => emit("update:workspaceMode", value) });
const theme = computed({ get: () => store.state.appearance.theme, set: (value: ThemeMode) => updateAppearance({ theme: value }) });
const fontFamily = computed({ get: () => store.state.appearance.fontFamily, set: (value: string) => updateAppearance({ fontFamily: value }) });
const fontSize = computed({
  get: () => store.state.appearance.fontSize,
  set: (value: number | null) => updateAppearance({ fontSize: Math.min(20, Math.max(12, value ?? 14)) })
});
const accentColor = computed({ get: () => store.state.appearance.accentColor, set: (value: string) => updateAppearance({ accentColor: value }) });
const commandShellPath = computed({ get: () => props.commandShellPath, set: (value: string) => emit("update:commandShellPath", value) });
const unwrapPowerShellCommands = computed({ get: () => store.state.appearance.unwrapPowerShellCommands, set: (value: boolean) => updateAppearance({ unwrapPowerShellCommands: value }) });
const mcpGatewayAdaptation = computed({ get: () => store.state.appearance.mcpGatewayAdaptation, set: (value: boolean) => updateAppearance({ mcpGatewayAdaptation: value }) });
const systemFonts = ref<string[]>([]);
const fontListState = ref<"idle" | "loading" | "ready" | "unavailable" | "denied">("idle");
const diagnosticsState = ref<"idle" | "copying" | "copied" | "empty" | "error">("idle");
const diagnosticsError = ref("");
const runtimeAction = ref<"idle" | "choosing" | "clearing">("idle");
const runtimeError = ref("");
const fontOptions = computed(() => systemFonts.value.map((family) => ({ label: family, value: family })));
const display = (value: string | null | undefined): string => value || "—";
const noSpellcheckInputProps = { spellcheck: false, autocorrect: "off", autocapitalize: "off" } as const;
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
const copyDiagnostics = async (): Promise<void> => {
  if (diagnosticsState.value === "copying") return;
  diagnosticsState.value = "copying";
  diagnosticsError.value = "";
  try {
    const lines = await window.codexPane.readDiagnostics();
    if (!lines.length) {
      diagnosticsState.value = "empty";
      return;
    }
    await window.codexPane.copyText(lines.join("\n"));
    diagnosticsState.value = "copied";
  } catch (error) {
    diagnosticsState.value = "error";
    diagnosticsError.value = error instanceof Error ? error.message : String(error);
  }
};
const runRuntimeAction = async (action: "choosing" | "clearing"): Promise<void> => {
  if (runtimeAction.value !== "idle") return;
  runtimeAction.value = action;
  runtimeError.value = "";
  try {
    if (action === "choosing") await store.chooseDefaultDirectory();
    else await store.clearDefaultDirectory();
  } catch (error) {
    runtimeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    runtimeAction.value = "idle";
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
        <div class="settings-section-heading"><NText strong>工作台</NText><NText depth="3">选择会话的查看方式。</NText></div>
        <NForm label-placement="left" label-width="148" class="settings-form">
          <NFormItem label="工作台模式">
            <NRadioGroup v-model:value="workspaceMode" name="workspace-mode">
              <NRadioButton value="panes">多窗格</NRadioButton>
              <NRadioButton value="sessionSidebar">会话侧栏</NRadioButton>
            </NRadioGroup>
          </NFormItem>
        </NForm>
      </section>
      <NDivider />
      <section class="settings-section">
        <div class="settings-section-heading"><NText strong>外观</NText><NSpace align="center"><NText depth="3">更改会立即应用。</NText><NButton size="tiny" secondary @click="store.resetAppearance">恢复默认</NButton></NSpace></div>
        <NForm label-placement="left" label-width="148" class="settings-form">
          <NFormItem label="主题">
            <NRadioGroup v-model:value="theme" name="appearance-theme"><NRadioButton value="system">跟随系统</NRadioButton><NRadioButton value="dark">深色</NRadioButton><NRadioButton value="light">浅色</NRadioButton></NRadioGroup>
          </NFormItem>
          <NFormItem label="界面字体">
            <div class="font-field">
              <NAutoComplete v-model:value="fontFamily" :options="fontOptions" :input-props="noSpellcheckInputProps" clearable placeholder="输入或选择系统字体，留空使用默认字体" />
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
                  <NButton type="primary" secondary :loading="runtimeAction === 'choosing'" :disabled="runtimeAction !== 'idle'" @click="runRuntimeAction('choosing')">选择目录</NButton>
                  <NButton v-if="store.state.defaultCwd" secondary :loading="runtimeAction === 'clearing'" :disabled="runtimeAction !== 'idle'" @click="runRuntimeAction('clearing')">清空</NButton>
                </NSpace>
              </NSpace>
            </NCard>
          </NFormItem>
          <NAlert v-if="runtimeError" type="error" closable @close="runtimeError = ''">无法更新运行目录：{{ runtimeError }}</NAlert>
          <NFormItem label="pwsh 路径">
            <NInput v-model:value="commandShellPath" :input-props="noSpellcheckInputProps" clearable placeholder="C:\Program Files\PowerShell\7\pwsh.exe" />
          </NFormItem>
          <NFormItem label="简化 pwsh 命令">
            <NSwitch v-model:value="unwrapPowerShellCommands" />
          </NFormItem>
          <NFormItem label="MCP Gateway 适配">
            <div class="switch-with-help"><NSwitch v-model:value="mcpGatewayAdaptation" /><NText depth="3">把 gateway_call_tool / call_tool 的目标服务与真实工具名称直接展示在工具卡片中；只影响显示，不修改协议请求。</NText></div>
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
      <NDivider />
      <section class="settings-section">
        <div class="settings-section-heading"><NText strong>诊断与兼容性</NText><NText depth="3">最近 200 条</NText></div>
        <NDescriptions label-placement="left" bordered :column="2" class="diagnostics-summary">
          <NDescriptionsItem label="Codex Pane">{{ store.state.appVersion }}</NDescriptionsItem>
          <NDescriptionsItem label="连接状态">{{ store.state.connection.message }}</NDescriptionsItem>
          <NDescriptionsItem label="Codex 版本">{{ display(store.state.connection.codexVersion) }}</NDescriptionsItem>
        </NDescriptions>
        <NSpace align="center" class="diagnostics-actions">
          <NButton secondary :loading="diagnosticsState === 'copying'" @click="copyDiagnostics">复制脱敏诊断</NButton>
          <NText depth="3">用于报告连接和协议问题；凭据、令牌与用户目录会在写入日志前隐藏。</NText>
        </NSpace>
        <NAlert v-if="diagnosticsState === 'copied'" type="success">诊断信息已复制到剪贴板。</NAlert>
        <NAlert v-else-if="diagnosticsState === 'empty'" type="info">当前还没有诊断记录。</NAlert>
        <NAlert v-else-if="diagnosticsState === 'error'" type="error">无法复制诊断信息：{{ diagnosticsError }}</NAlert>
      </section>
    </NSpace>
    <template #footer><NSpace justify="end"><NButton type="primary" @click="emit('update:show', false)">完成</NButton></NSpace></template>
  </NModal>
</template>

<style scoped>
.settings-section { min-width: 0; }
.settings-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.settings-section-heading > :first-child { font-weight: 700; }
.settings-form { margin-top: 12px; }
.settings-form :deep(.n-form-item-label), :deep(.n-descriptions-table-header) { font-weight: 600; }
.directory-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.font-field { display: grid; width: 100%; gap: 5px; }
.switch-with-help { display: grid; gap: 5px; }
.font-field .n-text { font-size: 12px; }
.runtime-form :deep(.n-card) { width: 100%; }
.settings-form :deep(.n-input-number) { width: 100%; }
.permission-profiles { margin-top: 12px; }
.diagnostics-summary, .diagnostics-actions { margin-top: 12px; }
@media (max-width: 620px) {
  .settings-form :deep(.n-form-item) { grid-template-columns: 1fr !important; }
  .settings-form :deep(.n-form-item-label) { padding-bottom: 5px; text-align: left; }
}
</style>
