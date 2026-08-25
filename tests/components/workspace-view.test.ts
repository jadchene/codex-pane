// @vitest-environment jsdom

import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import WorkspaceView from "../../src/components/WorkspaceView.vue";
import { useWorkspaceStore } from "../../src/stores/workspace";

const passthrough = defineComponent({ setup: (_props, { slots }) => () => h("div", slots.default?.()) });
const paneHost = defineComponent({
  props: { index: { type: Number, required: true } },
  setup(props, { expose }) {
    expose({ focusComposer: vi.fn() });
    return () => h("section", { "data-test-pane": props.index });
  }
});

describe("WorkspaceView focus navigation", () => {
  it("moves the highlighted pane with Alt+Arrow without collapsing the layout", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const store = useWorkspaceStore();
    store.state.layout = "quad";
    store.state.focusedPaneId = store.state.panes[0]!.id;
    vi.spyOn(store, "scheduleSave").mockImplementation(() => undefined);
    const wrapper = mount(WorkspaceView, {
      global: { plugins: [pinia], stubs: { Splitpanes: passthrough, Pane: passthrough, PaneHost: paneHost } }
    });
    expect(wrapper.findAll("[data-test-pane]")).toHaveLength(4);
    expect(wrapper.get("main").classes()).toContain("workspace-layout-quad");
    await wrapper.get("main").trigger("keydown", { key: "ArrowRight", altKey: true });
    expect(store.state.focusedPaneId).toBe(store.state.panes[1]!.id);
    await wrapper.get("main").trigger("keydown", { key: "ArrowDown", altKey: true });
    expect(store.state.focusedPaneId).toBe(store.state.panes[3]!.id);
    expect(wrapper.findAll("[data-test-pane]")).toHaveLength(4);
  });
});
