// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { NDropdown, NSelect } from "naive-ui";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaneView from "../../src/components/PaneView.vue";
import type { PaneState, PendingServerRequest } from "../../src/types";

const pane = (): PaneState => ({
  id: "pane-1",
  title: "分析协议适配",
  threadId: "thread-secret-12345678",
  cwd: "",
  draft: "",
  attachments: [],
  references: [],
  skills: [],
  activePermissionProfile: null,
  model: "gpt-5",
  effort: "medium",
  activeTurnId: null,
  status: "idle",
  items: [],
  tokenUsage: null,
  error: null,
  unread: false,
  scrollTop: 300,
  followTail: false
});
const models = [{ label: "GPT-5", value: "gpt-5", efforts: ["low", "medium", "high"], inputModalities: ["text", "image"], defaultEffort: "medium" }];
const request = (): PendingServerRequest => ({ generation: 1, id: "approval-1", method: "item/commandExecution/requestApproval", params: {}, paneId: "pane-1", createdAt: 1 });
const mountPane = (value = reactive(pane()), pendingRequests: PendingServerRequest[] = []) => ({
  value,
  wrapper: mount(PaneView, {
    attachTo: document.body,
    props: { pane: value, defaultCwd: "E:\\Work", models, focused: false, pendingRequests, approvalResolving: false, rateLimitLabels: ["5h 80%"] },
    global: {
      stubs: {
        ItemCard: true,
        ApprovalCenter: { template: "<div class='approval-stub' />" },
        NTooltip: { template: "<span><slot name='trigger' /><slot /></span>" }
      }
    }
  })
});

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PaneView compact workbench interactions", () => {
  it("keeps the pane header focused on title and working state", async () => {
    const { value, wrapper } = mountPane();
    const header = wrapper.get(".pane-header");
    expect(header.text()).toContain("分析协议适配");
    expect(header.findAll("button")).toHaveLength(0);
    for (const removedLabel of ["选择工作目录", "新建会话", "恢复历史会话", "聚焦此窗格"]) {
      expect(wrapper.find(`button[aria-label="${removedLabel}"]`).exists()).toBe(false);
    }
    value.status = "running";
    await nextTick();
    expect(wrapper.get('.status-line [role="status"]').text()).toContain("Working");
    expect(wrapper.find(".composer-runtime-line").exists()).toBe(false);
  });

  it("does not show a jump-to-latest action and omits the session id", () => {
    const { wrapper } = mountPane();
    expect(wrapper.text()).not.toContain("跳到最新内容");
    expect(wrapper.text()).not.toContain("thread-secret");
    expect(wrapper.text()).not.toContain("会话 thread");
  });

  it("uses compact model and reasoning selectors", () => {
    const { wrapper } = mountPane();
    const selects = wrapper.findAllComponents(NSelect);
    expect(selects).toHaveLength(2);
    expect(selects[0]!.classes()).toContain("compact-select");
    expect(selects[0]!.classes()).toContain("model-select");
    expect(selects[1]!.classes()).toContain("effort-select");
    expect(selects[0]!.props("size")).toBe("tiny");
    expect(selects[1]!.props("size")).toBe("tiny");
    expect(selects[0]!.props("consistentMenuWidth")).toBe(false);
    expect(selects[1]!.props("consistentMenuWidth")).toBe(false);
    expect(selects[0]!.props("menuProps")).toEqual({ class: "content-fit-select-menu" });
    expect(selects[1]!.props("menuProps")).toEqual({ class: "content-fit-select-menu" });
    expect(wrapper.get(".model-select-fit .select-width-sizer").text()).toContain("GPT-5");
    expect(wrapper.get(".effort-select-fit .select-width-sizer").text()).toContain("medium");
  });

  it("does not let model or effort selectors return focus to the composer", async () => {
    const { wrapper } = mountPane();
    const textarea = wrapper.get("textarea").element;
    const selections = wrapper.findAll(".n-base-selection");
    await selections[0]!.trigger("mousedown");
    await selections[0]!.trigger("click");
    expect(document.activeElement).not.toBe(textarea);
    await selections[1]!.trigger("mousedown");
    await selections[1]!.trigger("click");
    expect(document.activeElement).not.toBe(textarea);
  });

  it("opens slash commands and completes /cwd with Tab and Enter", async () => {
    const { value, wrapper } = mountPane();
    await wrapper.get('button[aria-label="斜杠命令"]').trigger("click");
    await nextTick();
    expect(value.draft).toBe("/");
    const dropdown = wrapper.getComponent(NDropdown);
    expect(dropdown.props("show")).toBe(true);
    expect(dropdown.props("options")).toHaveLength(12);
    const textarea = wrapper.get("textarea");
    await textarea.setValue("/cw");
    await textarea.trigger("keydown", { key: "Tab" });
    expect(value.draft).toBe("/cwd");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("slashCommand")?.at(-1)).toEqual(["cwd"]);
  });

  it("uses arrow keys and Enter to execute the highlighted slash command", async () => {
    const { value, wrapper } = mountPane();
    const textarea = wrapper.get("textarea");
    await textarea.setValue("/res");
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("openSessions")).toHaveLength(1);
    expect(wrapper.emitted("send")).toBeUndefined();
    expect(value.draft).toBe("");
  });

  it("sorts slash commands alphabetically and shows used context", async () => {
    const { value, wrapper } = mountPane();
    value.contextRemainingPercent = 62;
    await wrapper.get('button[aria-label="斜杠命令"]').trigger("click");
    await nextTick();
    const labels = (wrapper.getComponent(NDropdown).props("options") ?? []).map((option) => String(option.key));
    expect(labels).toEqual(["slash:agents", "slash:compact", "slash:cwd", "slash:kill-processes", "slash:mcp", "slash:new", "slash:permissions", "slash:processes", "slash:resume", "slash:review", "slash:skills", "slash:status"]);
    expect(wrapper.get(".status-line").text()).toContain("上下文 38%");
  });

  it("opens Skills with @ and uses one attachment action for files and images", async () => {
    const { value, wrapper } = mountPane();
    value.skills = [{ name: "project-verify", description: "验证项目", path: "E:\\Skills\\project-verify\\SKILL.md" }];
    await wrapper.get('button[aria-label="选择 Skill"]').trigger("click");
    await nextTick();
    expect(wrapper.emitted("openSkills")).toHaveLength(1);
    expect(value.draft).toBe("@");
    await wrapper.get('button[aria-label="选择 Skill"]').trigger("click");
    expect(value.draft).toBe("@");
    const composerDropdown = wrapper.findAllComponents(NDropdown).find((dropdown) => dropdown.props("trigger") === "manual")!;
    expect(composerDropdown.props("options")?.[0]?.key).toBe("skill:project-verify");
    expect(composerDropdown.props("options")?.[0]?.label).toBe("project-verify");
    expect(composerDropdown.props("scrollable")).toBe(true);
    expect(composerDropdown.props("menuProps")?.(undefined, [])).toMatchObject({
      class: "composer-options-menu",
      style: "max-height: min(320px, calc(100vh - 180px));"
    });
    composerDropdown.vm.$emit("select", "skill:project-verify");
    await nextTick();
    expect(value.draft).toBe("@project-verify ");
    await wrapper.get('button[aria-label="添加附件"]').trigger("click");
    expect(wrapper.emitted("chooseAttachments")).toHaveLength(1);
  });

  it("leaves pasted text in the composer and routes pasted files through attachments", async () => {
    const { wrapper } = mountPane();
    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", { clipboardData: { files: [], items: [{ kind: "string", type: "text/plain" }], getData: () => "E:\\Work\\notes.txt" } });
    expect(wrapper.emitted("pasteAttachments")).toBeUndefined();
    await textarea.trigger("paste", { clipboardData: { files: [{ path: "E:\\Work\\notes.txt" }], items: [{ kind: "file", type: "text/plain" }], getData: () => "" } });
    expect(wrapper.emitted("pasteAttachments")?.at(-1)).toEqual([["E:\\Work\\notes.txt"]]);
  });

  it("scrolls the current pane to the bottom when ArrowDown is pressed on an empty composer", async () => {
    const { wrapper } = mountPane();
    const output = wrapper.get(".pane-output").element as HTMLElement;
    Object.defineProperty(output, "scrollHeight", { configurable: true, value: 1400 });
    await wrapper.get("textarea").trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    expect(output.scrollTop).toBe(1400);
    expect(wrapper.emitted("scrollState")?.at(-1)).toEqual([1400, true]);
  });

  it("returns focus to the composer after the inline approval completes", async () => {
    const { wrapper } = mountPane(reactive(pane()), [request()]);
    const textarea = wrapper.get("textarea").element;
    await wrapper.setProps({ pendingRequests: [] });
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(textarea);
  });

  it("restores a saved reading position after asynchronous history hydration", async () => {
    const { value, wrapper } = mountPane();
    const output = wrapper.get(".pane-output").element as HTMLElement;
    Object.defineProperty(output, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(output, "clientHeight", { configurable: true, value: 400 });
    value.items.push({ id: "message-1", turnId: "turn-1", type: "agentMessage", data: { type: "agentMessage", id: "message-1", text: "history" }, streamText: "", status: "completed" });
    await nextTick();
    await nextTick();
    expect(output.scrollTop).toBe(300);
  });
});
