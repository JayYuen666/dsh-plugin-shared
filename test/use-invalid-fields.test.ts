// @vitest-environment happy-dom
// lib/card-ui/invalid.ts 的 `useInvalidFields()` 单元测试：越界状态机的四条判据。
//
// 为什么要在这一层钉：这套状态（越界集 + 重置信号 + 清空）原先在多个消费仓各写一遍，
// 现在收进 shared。它的两个出口都只在**行为**上看得出来——`clear()` 漏掉的表现是保存后
// 红框还在，`resetToken` 不推进的表现是撤销后非法值仍留在框里，两者都不是类型能拦的。
// 本文件用一枚最小探针组件驱动它，判据全部写成「先做什么、再读到什么」，不从实现推导。
//
// 受影响的公共面：`lib/card-ui/invalid.ts` 的 `useInvalidFields` / `InvalidFields`（经
// `lib/card-ui.ts` 汇总、由 `lib/client-entry.ts` 从 `./client` 导出）；同步面：`test/index.test.ts`
// 与 `test/publish-manifest.test.ts` 已覆盖这两个 barrel 的导出面，本文件补的是行为判据。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { useInvalidFields } from "../lib/card-ui/invalid.ts";
import { click, mount, textOf } from "./card-ui-helpers.ts";

/** 探针：把整套状态摊到 DOM 上，让用例能从外面读写它。
 *
 * 写成组件（`createElement(Probe, …)`）而不是直接调 `probe()`：直接调用等于在 React 的渲染
 * 之外调 `useState`，拿到的 dispatcher 是 null（`Cannot read properties of null`）。
 */
function Probe(props: {
  readonly onReady: (ready: ReturnType<typeof useInvalidFields>) => void;
}): ReactElement {
  const state = useInvalidFields();
  props.onReady(state);
  return createElement(
    "div",
    null,
    createElement("span", { className: "blocked" }, String(state.blocked)),
    createElement("span", { className: "token" }, String(state.resetToken)),
    createElement("span", { className: "count" }, String(state.count)),
    createElement(
      "button",
      {
        type: "button",
        className: "mark",
        onClick: () => {
          state.reportInvalid("resumeDelayMs", true);
        },
      },
      "mark",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "unmark",
        onClick: () => {
          state.reportInvalid("resumeDelayMs", false);
        },
      },
      "unmark",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "markOther",
        onClick: () => {
          state.reportInvalid("maxRetries", true);
        },
      },
      "markOther",
    ),
    createElement("button", { type: "button", className: "clear", onClick: state.clear }, "clear"),
  );
}

/**
 * 挂载探针并把每次渲染的句柄记下来。
 * @returns 容器与最近一次渲染的句柄
 */
async function mountProbe(): Promise<{
  readonly container: HTMLElement;
  readonly latest: () => ReturnType<typeof useInvalidFields>;
}> {
  let latest: ReturnType<typeof useInvalidFields> | undefined;
  const view = await mount(
    createElement(Probe, {
      onReady: (ready) => {
        latest = ready;
      },
    }),
  );
  return {
    container: view.container,
    latest: (): ReturnType<typeof useInvalidFields> => {
      if (latest === undefined) {
        throw new Error("探针还没渲染过");
      }
      return latest;
    },
  };
}

/**
 * 取一个必然存在的节点；不存在就让用例当场失败（而不是把断言挂在 null 上）。
 * @param container - 容器
 * @param selector - 选择器
 * @returns 节点
 */
function nodeOf(container: HTMLElement, selector: string): Element {
  const found = container.querySelector(selector);
  assert.ok(found !== null, `找不到节点：${selector}`);
  return found;
}

describe("useInvalidFields", () => {
  it("起始态：没有越界字段、重置信号是 0", async () => {
    const { container, latest } = await mountProbe();
    assert.equal(textOf(container, ".blocked"), "false");
    assert.equal(textOf(container, ".token"), "0");
    assert.equal(latest().blocked, false);
  });

  it("上报越界后 blocked 转真；同一字段恢复合法后转回假", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".mark"));
    assert.equal(textOf(container, ".blocked"), "true");
    await click(nodeOf(container, ".unmark"));
    assert.equal(textOf(container, ".blocked"), "false");
  });

  it("重复上报同一状态不推进重置信号（否则打字过程会反复清框）", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".mark"));
    const afterFirst = textOf(container, ".token");
    await click(nodeOf(container, ".mark"));
    assert.equal(textOf(container, ".token"), afterFirst);
  });

  it("两格同时越界时 count 是 2，保存条据此把越界算进「已修改 N 项」", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".mark"));
    await click(nodeOf(container, ".markOther"));
    assert.equal(textOf(container, ".count"), "2");
    await click(nodeOf(container, ".unmark"));
    assert.equal(textOf(container, ".count"), "1");
  });

  it("clear() 一次清空越界集合并推进一次重置信号", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".mark"));
    assert.equal(textOf(container, ".blocked"), "true");
    const before = Number(textOf(container, ".token"));
    await click(nodeOf(container, ".clear"));
    assert.equal(textOf(container, ".blocked"), "false");
    assert.equal(textOf(container, ".count"), "0");
    assert.equal(Number(textOf(container, ".token")), before + 1);
  });
});
