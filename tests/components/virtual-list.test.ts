// @vitest-environment jsdom

import { h } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import VirtualList from "../../src/components/VirtualList.vue";

describe("VirtualList", () => {
  it("keeps a ten-thousand-item conversation bounded to the visible window", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) => ({ id: `item-${index}`, text: `message ${index}` }));
    const wrapper = mount(VirtualList, {
      props: {
        items,
        itemKey: (item: unknown) => (item as { id: string }).id,
        estimateSize: () => 64,
        minItemSize: 56,
        buffer: 160
      },
      slots: {
        default: ({ item }: { item: unknown }) => h("article", { class: "virtual-row" }, (item as { text: string }).text)
      }
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.attributes("data-total-items")).toBe("10000");
    expect(wrapper.findAll(".virtual-row").length).toBeGreaterThan(0);
    expect(wrapper.findAll(".virtual-row").length).toBeLessThan(50);
  });

  it("preserves the visible anchor when an older page is prepended", async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `item-${index}`, text: `message ${index}` }));
    const wrapper = mount(VirtualList, {
      props: {
        items,
        itemKey: (item: unknown) => (item as { id: string }).id,
        estimateSize: () => 64,
        minItemSize: 56,
        buffer: 160
      },
      slots: {
        default: ({ item }: { item: unknown }) => h("article", { class: "virtual-row" }, (item as { text: string }).text)
      }
    });
    const scroller = wrapper.element as HTMLElement;
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 320 });
    scroller.scrollTop = 640;
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    const anchorText = wrapper.find(".virtual-row").text();

    const olderItems = Array.from({ length: 10 }, (_, index) => ({ id: `older-${index}`, text: `older ${index}` }));
    await wrapper.setProps({ items: [...olderItems, ...items] });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));

    expect(wrapper.find(".virtual-row").text()).toBe(anchorText);
    expect(scroller.scrollTop).toBe(1_280);
  });
});
