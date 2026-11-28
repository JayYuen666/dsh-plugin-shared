// @vitest-environment happy-dom
// lib/card-ui/draft.ts 的 `useCardDraft()` 行为判据：草稿优先、差异计数、丢弃与收窄。
//
// 这套状态原先在七张设置卡上各写一遍；收进 shared 后，真正会出错的地方都不是类型能拦的：
// `eff` 读错来源会让受控输入吞键击、`pendingCount` 漏掉越界字段会让保存条显示「没有修改」、
// `discard` 不清越界集会留下红框。本文件用最小探针把这几条逐条钉住。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import { useCardDraft } from "../lib/card-ui/draft.ts";
import { click, mount, textOf } from "./card-ui-helpers.ts";

const VALUE = { alpha: "base", beta: 2, constructor: "ctor-base" } as const;

/** 探针：把草稿层摊到 DOM 上，让用例从外面读写。 */
function Probe(props: {
  readonly onReady: (ready: ReturnType<typeof useCardDraft>) => void;
  readonly parseField?: (field: string, value: unknown) => unknown;
}): ReactElement {
  const state = useCardDraft(VALUE, {
    ...(props.parseField === undefined ? {} : { parseField: props.parseField }),
    onDiscard: () => {
      Reflect.set(globalThis, "__draftDiscarded", true);
    },
  });
  props.onReady(state);
  const effAlpha = String(state.eff("alpha"));
  const effBeta = String(state.eff("beta"));
  // `constructor` 在 `{}` 上沿原型链可读；`field in touched` 会把它误当成草稿。
  const effConstructor = String(state.eff("constructor"));
  const dirty = state.dirtyKeys.join(",");
  const pending = String(state.pendingCount);
  return createElement(
    "div",
    null,
    createElement("span", { className: "effAlpha" }, effAlpha),
    createElement("span", { className: "effBeta" }, effBeta),
    createElement("span", { className: "effConstructor" }, effConstructor),
    createElement("span", { className: "dirty" }, dirty),
    createElement("span", { className: "pending" }, pending),
    createElement(
      "button",
      {
        type: "button",
        className: "setAlpha",
        onClick: () => {
          state.setField("alpha", "draft");
        },
      },
      "setAlpha",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "clearAlpha",
        onClick: () => {
          state.clearField("alpha");
        },
      },
      "clearAlpha",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "setBeta",
        onClick: () => {
          state.setField("beta", "4");
        },
      },
      "setBeta",
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "markBeta",
        onClick: () => {
          state.invalid.reportInvalid("beta", true);
        },
      },
      "markBeta",
    ),
    createElement(
      "button",
      { type: "button", className: "discard", onClick: state.discard },
      "discard",
    ),
  );
}

/**
 * 挂载探针并记录最近一次句柄。
 * @param parseField - 可选的草稿收窄函数
 * @returns 容器与句柄
 */
async function mountProbe(parseField?: (field: string, value: unknown) => unknown): Promise<{
  readonly container: HTMLElement;
  readonly latest: () => ReturnType<typeof useCardDraft>;
}> {
  let latest: ReturnType<typeof useCardDraft> | undefined;
  const view = await mount(
    createElement(Probe, {
      onReady: (ready) => {
        latest = ready;
      },
      ...(parseField === undefined ? {} : { parseField }),
    }),
  );
  return {
    container: view.container,
    latest: (): ReturnType<typeof useCardDraft> => {
      if (latest === undefined) {
        throw new Error("探针还没渲染过");
      }
      return latest;
    },
  };
}

/**
 * 取必然存在的节点。
 * @param container - 容器
 * @param selector - 选择器
 * @returns 节点
 */
function nodeOf(container: HTMLElement, selector: string): Element {
  const found = container.querySelector(selector);
  assert.ok(found !== null, `找不到节点：${selector}`);
  return found;
}

describe("useCardDraft", () => {
  it("起始态：eff 读快照、没有差异、没有越界", async () => {
    const { container } = await mountProbe();
    assert.equal(textOf(container, ".effAlpha"), "base");
    assert.equal(textOf(container, ".effBeta"), "2");
    assert.equal(textOf(container, ".effConstructor"), "ctor-base", "继承键不算草稿");
    assert.equal(textOf(container, ".dirty"), "");
    assert.equal(textOf(container, ".pending"), "0");
  });

  it("setField 后 eff 优先读草稿，dirty 只列改过的键", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".setAlpha"));
    assert.equal(textOf(container, ".effAlpha"), "draft");
    assert.equal(textOf(container, ".effBeta"), "2", "未改过的字段必须继续跟随快照");
    assert.equal(textOf(container, ".effConstructor"), "ctor-base", "改其它键不影响继承键读取");
    assert.equal(textOf(container, ".dirty"), "alpha");
  });

  it("clearField 写 undefined：快照有值时仍算改动（unset 语义）", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".clearAlpha"));
    assert.equal(textOf(container, ".effAlpha"), "undefined");
    assert.equal(textOf(container, ".dirty"), "alpha");
  });

  it("越界字段计入 pendingCount（按字段去重，不重复计一次草稿 + 一次越界）", async () => {
    const { container } = await mountProbe();
    await click(nodeOf(container, ".setAlpha"));
    await click(nodeOf(container, ".markBeta"));
    assert.equal(textOf(container, ".pending"), "2");
    await click(nodeOf(container, ".markBeta"));
    assert.equal(textOf(container, ".pending"), "2", "同一字段重复上报不重复计数");
  });

  it("discard 清空草稿、越界集并跑 onDiscard；resetToken 推进", async () => {
    Reflect.set(globalThis, "__draftDiscarded", false);
    const { container, latest } = await mountProbe();
    await click(nodeOf(container, ".setAlpha"));
    await click(nodeOf(container, ".markBeta"));
    const tokenBefore = latest().invalid.resetToken;
    await click(nodeOf(container, ".discard"));
    assert.equal(textOf(container, ".effAlpha"), "base");
    assert.equal(textOf(container, ".pending"), "0");
    assert.equal(latest().invalid.blocked, false);
    assert.equal(latest().invalid.resetToken, tokenBefore + 1);
    assert.equal(Reflect.get(globalThis, "__draftDiscarded"), true);
  });

  it("parseField 只作用于草稿值，未改过的字段仍读快照原值", async () => {
    const { container } = await mountProbe((field, value) =>
      field === "beta" ? Number(value) + 1 : value,
    );
    await click(nodeOf(container, ".setAlpha"));
    await click(nodeOf(container, ".setBeta"));
    assert.equal(textOf(container, ".effAlpha"), "draft");
    assert.equal(textOf(container, ".effBeta"), "5", "草稿值 beta=4 经 parseField +1 后渲染成 5");
  });
});
