// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionDrawer from "../../src/components/SessionDrawer.vue";
import type { PaneState } from "../../src/types";

const pane = {
  id: "pane-1",
  threadId: null
} as PaneState;

describe("SessionDrawer", () => {
  it("switches between the current working directory and all sessions", async () => {
    const wrapper = mount(SessionDrawer, {
      props: {
        show: true,
        pane,
        threads: [],
        showAll: false,
        currentCwd: "E:\\AI-Workspace"
      },
      global: { stubs: { teleport: true } }
    });

    expect(wrapper.text()).toContain("当前目录：E:\\AI-Workspace");
    await wrapper.get(".session-scope-button").trigger("click");
    expect(wrapper.emitted("scope")).toEqual([[true, ""]]);

    await wrapper.setProps({ showAll: true });
    expect(wrapper.text()).toContain("所有工作目录");
    expect(wrapper.get(".session-scope-button").text()).toBe("仅当前目录");
  });
});
