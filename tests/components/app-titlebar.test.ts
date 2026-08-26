// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { NDropdown } from "naive-ui";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App.vue";
import { useWorkspaceStore } from "../../src/stores/workspace";

describe("App titlebar", () => {
  beforeEach(() => {
    Object.defineProperty(window, "codexPane", {
      configurable: true,
      value: {
        onFullScreenChange: vi.fn(() => vi.fn()),
        onMaximizedChange: vi.fn(() => vi.fn()),
        isMaximized: vi.fn().mockResolvedValue(false),
        setFullScreen: vi.fn().mockResolvedValue(undefined),
        windowControl: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it("shows the app identity and icon-only layout and window actions", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useWorkspaceStore();
    store.state.connection = { phase: "ready", generation: 1, codexVersion: "0.149.1", compatible: true, message: "Codex 0.149.1 已连接" };
    store.state.accountLabel = "API 模式";
    const initialize = vi.spyOn(store, "initialize").mockResolvedValue(undefined);
    const setLayout = vi.spyOn(store, "setLayout").mockImplementation(() => undefined);
    vi.spyOn(store, "reconnect").mockResolvedValue(undefined);
    const wrapper = mount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          WorkspaceView: { template: "<main />" },
          SessionDrawer: true,
          SettingsModal: true,
          NTooltip: { template: "<span><slot name='trigger' /><slot /></span>" }
        }
      }
    });
    expect(initialize).toHaveBeenCalledOnce();
    const titlebar = wrapper.get(".custom-titlebar");
    expect(titlebar.text()).toContain("Codex Pane");
    expect(titlebar.text()).not.toContain("已连接");
    expect(titlebar.text()).not.toContain("API 模式");
    const layoutButton = titlebar.get('button[aria-label="切换窗格布局，当前单窗格"]');
    expect(layoutButton.text()).toBe("");
    expect(titlebar.get(".titlebar-identity img").attributes("src")).toMatch(/^(?:data:image\/svg\+xml|.+icon\.svg)/);
    const dropdown = titlebar.getComponent(NDropdown);
    expect((dropdown.props("options") ?? []).map((option) => (option as { label: string }).label)).toEqual([
      "单窗格",
      "左右双栏",
      "上下双栏",
      "四宫格",
      "横向四栏",
      "纵向四栏",
      "六宫格"
    ]);
    dropdown.vm.$emit("select", "quad");
    expect(setLayout).toHaveBeenCalledWith("quad");
    for (const action of ["最小化", "最大化或还原窗口", "关闭"]) await titlebar.get(`button[aria-label="${action}"]`).trigger("click");
    expect(window.codexPane.windowControl).toHaveBeenNthCalledWith(1, "minimize");
    expect(window.codexPane.windowControl).toHaveBeenNthCalledWith(2, "maximize");
    expect(window.codexPane.windowControl).toHaveBeenNthCalledWith(3, "close");
    const fullScreenListener = vi.mocked(window.codexPane.onFullScreenChange).mock.calls[0]![0];
    fullScreenListener(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".custom-titlebar").exists()).toBe(false);
    expect(wrapper.get(".app-root").classes()).toContain("app-root-fullscreen");
  });

  it("removes empty panes first and asks before removing a pane with a session", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useWorkspaceStore();
    store.state.layout = "six";
    store.state.panes[5]!.threadId = "thread-six";
    store.state.panes[5]!.title = "需要保留";
    vi.spyOn(store, "initialize").mockResolvedValue(undefined);
    vi.spyOn(store, "scheduleSave").mockImplementation(() => undefined);
    vi.spyOn(store, "reconnect").mockResolvedValue(undefined);
    const wrapper = mount(App, {
      global: {
        plugins: [pinia],
        stubs: {
          WorkspaceView: { template: "<main />" },
          SessionDrawer: true,
          SettingsModal: true,
          NTooltip: { template: "<span><slot name='trigger' /><slot /></span>" },
          teleport: true
        }
      }
    });
    wrapper.getComponent(NDropdown).vm.$emit("select", "quad");
    await wrapper.vm.$nextTick();
    expect(store.state.layout).toBe("quad");
    expect(store.state.panes.slice(0, 4).some((pane) => pane.threadId === "thread-six")).toBe(true);

    store.state.layout = "six";
    for (let index = 0; index < 5; index += 1) {
      store.state.panes[index]!.threadId = `thread-${index}`;
      store.state.panes[index]!.title = `会话 ${index + 1}`;
    }
    wrapper.getComponent(NDropdown).vm.$emit("select", "quad");
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("选择要保留的窗格");
    expect(store.state.layout).toBe("six");
  });
});
