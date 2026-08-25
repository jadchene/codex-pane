// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ApprovalCenter from "../../src/components/ApprovalCenter.vue";
import type { PendingServerRequest } from "../../src/types";

const request = (id: string | number, method: string, paneId: string, params: Record<string, unknown>): PendingServerRequest => ({
  generation: 2,
  id,
  method,
  paneId,
  params,
  createdAt: 1
});

const drawerStubs = {
  teleport: true,
  Code: { props: ["code"], template: "<code>{{ code }}</code>" },
  NDrawer: { template: "<div><slot /></div>" },
  NDrawerContent: { props: ["title"], template: "<section><h2>{{ title }}</h2><slot /></section>" },
  NSpin: { template: "<div><slot /></div>" }
};

const mountCenter = (requests: PendingServerRequest[], paneId: string | null = null) => mount(ApprovalCenter, {
  props: { requests, paneId, show: true, resolving: false },
  global: { stubs: drawerStubs }
});

const clickButton = async (wrapper: ReturnType<typeof mountCenter>, label: string): Promise<void> => {
  const button = wrapper.findAll("button").find((candidate) => candidate.text().includes(label));
  expect(button, `button ${label}`).toBeDefined();
  await button!.trigger("click");
};

describe("ApprovalCenter request lifecycle UI", () => {
  it("filters to the selected pane and emits command approval or rejection", async () => {
    const first = request(1, "item/commandExecution/requestApproval", "pane-1", { command: "Get-ChildItem", availableDecisions: ["accept"] });
    const second = request(2, "item/commandExecution/requestApproval", "pane-2", { command: "Remove-Item sample.tmp", availableDecisions: ["accept", "decline"] });
    const wrapper = mountCenter([first, second], "pane-2");
    expect(wrapper.text()).toContain("Remove-Item sample.tmp");
    expect(wrapper.text()).not.toContain("Get-ChildItem");
    expect(wrapper.text()).toContain("1 项待处理");
    await clickButton(wrapper, "允许一次");
    await clickButton(wrapper, "拒绝");
    expect(wrapper.emitted("resolve")).toEqual([
      [second, { decision: "accept" }],
      [second, { decision: "decline" }]
    ]);
  });

  it("validates and submits a user-input answer", async () => {
    const userInput = request("question-1", "item/tool/requestUserInput", "pane-1", {
      questions: [{ id: "purpose", header: "用途", question: "请输入用途", isSecret: false }]
    });
    const wrapper = mountCenter([userInput]);
    await clickButton(wrapper, "提交回答");
    expect(wrapper.text()).toContain("请回答用途");
    await wrapper.get("textarea").setValue("用于验收");
    await clickButton(wrapper, "提交回答");
    expect(wrapper.emitted("resolve")?.at(-1)).toEqual([userInput, { answers: { purpose: { answers: ["用于验收"] } } }]);
  });

  it("submits provided user-input choices immediately", async () => {
    const userInput = request("question-choice", "item/tool/requestUserInput", "pane-1", {
      questions: [{ id: "mode", header: "模式", question: "请选择模式", options: [{ label: "安全", description: "只读执行" }, { label: "完整", description: "允许修改" }] }]
    });
    const wrapper = mountCenter([userInput]);
    expect(wrapper.text()).not.toContain("提交回答");
    await clickButton(wrapper, "安全");
    expect(wrapper.emitted("resolve")).toEqual([[userInput, { answers: { mode: { answers: ["安全"] } } }]]);
  });

  it("submits MCP form data and supports decline and cancel", async () => {
    const elicitation = request(3, "mcpServer/elicitation/request", "pane-1", {
      mode: "form",
      requestedSchema: {
        type: "object",
        properties: { project: { type: "string", title: "项目" } },
        required: ["project"]
      },
      _meta: { source: "test" }
    });
    const wrapper = mountCenter([elicitation]);
    await clickButton(wrapper, "提交");
    expect(wrapper.text()).toContain("请填写项目");
    await wrapper.get("input").setValue("codex-pane");
    await clickButton(wrapper, "提交");
    await clickButton(wrapper, "拒绝");
    await clickButton(wrapper, "取消");
    expect(wrapper.emitted("resolve")).toEqual([
      [elicitation, { action: "accept", content: { project: "codex-pane" }, _meta: { source: "test" } }],
      [elicitation, { action: "decline", content: null, _meta: null }],
      [elicitation, { action: "cancel", content: null, _meta: null }]
    ]);
  });

  it("submits a single MCP enum option without extra confirmation buttons", async () => {
    const elicitation = request(33, "mcpServer/elicitation/request", "pane-1", {
      mode: "form",
      requestedSchema: {
        type: "object",
        properties: { environment: { type: "string", title: "环境", enum: ["测试", "生产"] } },
        required: ["environment"]
      }
    });
    const wrapper = mountCenter([elicitation]);
    expect(wrapper.text()).not.toContain("提交");
    expect(wrapper.text()).not.toContain("拒绝");
    await clickButton(wrapper, "测试");
    expect(wrapper.emitted("resolve")).toEqual([[elicitation, { action: "accept", content: { environment: "测试" }, _meta: null }]]);
  });

  it("opens an MCP URL only through the preload contract", async () => {
    const openExternal = vi.fn(async () => undefined);
    window.codexPane = { openExternal } as unknown as Window["codexPane"];
    const elicitation = request(4, "mcpServer/elicitation/request", "pane-1", { mode: "url", url: "https://example.com/consent" });
    const wrapper = mountCenter([elicitation]);
    expect(wrapper.text()).toContain("example.com");
    await clickButton(wrapper, "在浏览器中打开");
    expect(openExternal).toHaveBeenCalledWith("https://example.com/consent");
  });
});
