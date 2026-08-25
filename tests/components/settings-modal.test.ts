// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { NAutoComplete, NColorPicker, NInput, NInputNumber, NRadioGroup, NSwitch } from "naive-ui";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsModal from "../../src/components/SettingsModal.vue";
import { useWorkspaceStore } from "../../src/stores/workspace";
import { appearanceCssVars, appearanceThemeOverrides } from "../../src/theme";

describe("SettingsModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: vi.fn().mockResolvedValue([{ family: "Microsoft YaHei UI" }, { family: "Cascadia Code" }, { family: "Microsoft YaHei UI" }])
    });
  });

  it("updates theme, font, size, and accent color", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useWorkspaceStore();
    const wrapper = mount(SettingsModal, { props: { show: true }, global: { plugins: [pinia], stubs: { teleport: true } } });
    wrapper.getComponent(NRadioGroup).vm.$emit("update:value", "light");
    wrapper.getComponent(NAutoComplete).vm.$emit("update:value", "Cascadia Code");
    wrapper.getComponent(NInputNumber).vm.$emit("update:value", 18);
    wrapper.getComponent(NColorPicker).vm.$emit("update:value", "#ff3366");
    await wrapper.vm.$nextTick();
    expect(store.state.appearance).toMatchObject({ theme: "light", fontFamily: "Cascadia Code", fontSize: 18, accentColor: "#ff3366" });
    expect((window as typeof window & { queryLocalFonts: ReturnType<typeof vi.fn> }).queryLocalFonts).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("已读取 2 个字体系列");
    wrapper.getComponent(NSwitch).vm.$emit("update:value", true);
    expect(store.state.appearance.mcpGatewayAdaptation).toBe(true);
  });

  it("applies the configured font family and size to application and component tokens", () => {
    const appearance = { theme: "dark" as const, fontFamily: "Microsoft YaHei UI", fontSize: 18, accentColor: "#10a37f", commandShellPath: "", mcpGatewayAdaptation: false };
    expect(appearanceCssVars(appearance)).toMatchObject({ "--app-font-family": "Microsoft YaHei UI", "--app-font-size": "18px", "--app-diff-add": "#213a2b", "--app-diff-delete": "#4a221d" });
    expect(appearanceThemeOverrides(appearance).common).toMatchObject({ fontFamily: "Microsoft YaHei UI", fontFamilyMono: "Microsoft YaHei UI", fontSize: "18px", fontSizeTiny: "16px", fontSizeSmall: "17px", fontSizeMedium: "18px" });
  });

  it("allows a command shell path to be edited or cleared and has an explicit close action", async () => {
    const pinia = createPinia();
    const wrapper = mount(SettingsModal, { props: { show: true, commandShellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" }, global: { plugins: [pinia], stubs: { teleport: true } } });
    const shellInput = wrapper.findAllComponents(NInput).find((input) => input.props("placeholder")?.includes("PowerShell"));
    expect(shellInput).toBeTruthy();
    shellInput!.vm.$emit("update:value", "");
    expect(wrapper.emitted("update:commandShellPath")?.at(-1)).toEqual([""]);
    await wrapper.findAll("button").find((button) => button.text() === "完成")!.trigger("click");
    expect(wrapper.emitted("update:show")?.at(-1)).toEqual([false]);
  });

  it("falls back to the Windows font inventory when the browser list is empty", async () => {
    const pinia = createPinia();
    vi.mocked((window as typeof window & { queryLocalFonts: ReturnType<typeof vi.fn> }).queryLocalFonts).mockResolvedValueOnce([]);
    Object.defineProperty(window, "codexPane", { configurable: true, value: { listSystemFonts: vi.fn().mockResolvedValue(["Segoe UI", "Microsoft YaHei UI"]) } });
    const wrapper = mount(SettingsModal, { props: { show: true }, global: { plugins: [pinia], stubs: { teleport: true } } });
    await vi.waitFor(() => expect(wrapper.text()).toContain("已读取 2 个字体系列"));
    expect(window.codexPane.listSystemFonts).toHaveBeenCalledOnce();
  });

  it("shows and controls the global default directory", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useWorkspaceStore();
    store.state.defaultCwd = "E:\\Personal\\codex-pane";
    const choose = vi.spyOn(store, "chooseDefaultDirectory").mockResolvedValue(undefined);
    const clear = vi.spyOn(store, "clearDefaultDirectory").mockResolvedValue(undefined);
    const wrapper = mount(SettingsModal, { props: { show: true }, global: { plugins: [pinia], stubs: { teleport: true } } });
    expect(wrapper.text()).toContain("E:\\Personal\\codex-pane");
    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text().includes("选择目录"))!.trigger("click");
    await buttons.find((button) => button.text().includes("清空"))!.trigger("click");
    expect(choose).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("/cwd");
  });
});
