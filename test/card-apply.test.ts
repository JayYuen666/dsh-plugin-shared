// test/card-apply.test.ts —— 客户端卡片 apply 幂等守卫单测。

import { describe, expect, it } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { claimApply } from "../lib/card-apply.ts";
import type { CardApplyCtx } from "../lib/card-apply.ts";

interface EffectSpy {
  calls: { label: string | undefined; cleanup: (() => void) | undefined }[];
}

/** 三次 claim 都挂同一个 effect 标签：断言只看 flag，标签只是可观测线索。 */
const CLAIM_LABEL = "test: claim";

function spyCtx(): EffectSpy {
  const spy: EffectSpy = { calls: [] };
  return spy;
}

/**
 * 夹具的 ctx 面就是生产的 `CardApplyCtx`（其 `effect` 绑官方 `Context['effect']`）——
 * 不再自写一条 `(factory: () => (() => void) | undefined, label?) => void`：那条比官方
 * 宽（`SyncEffect` 不收 undefined），按 contravariance 反而**装不进**官方 ctx，
 * 正是三个卡片包各自撞出 TS2345 的同一处。
 * 一次性投影到官方签名：官方是两条重载（同步 `Disposable` 与可 await 的
 * `AsyncDisposable`），单个箭头签名同时满足不了两边（同 ctx-observe 客户端测试的手法）。
 */
function ctxWith(spy: EffectSpy): CardApplyCtx {
  return {
    effect: ((factory: () => () => void, label?: string): void => {
      const cleanup = factory();
      spy.calls.push({ label, cleanup });
    }) as Context["effect"],
  };
}

describe("claimApply", () => {
  it("首次 claim 成功并挂卸载清理；重复 apply 被拒", () => {
    const spy = spyCtx();
    const ctx = ctxWith(spy);
    expect(claimApply(ctx, "__testApplied", CLAIM_LABEL)).toBe(true);
    // 第二次同 flag：globalThis 标记未复位前拒绝。
    const again = ctxWith(spyCtx());
    expect(claimApply(again, "__testApplied", CLAIM_LABEL)).toBe(false);
    // 清理函数复位标记后再次 claim 成功。
    const cleanup = spy.calls[0]?.cleanup;
    expect(cleanup).toBeTypeOf("function");
    cleanup?.();
    const afterDispose = ctxWith(spyCtx());
    expect(claimApply(afterDispose, "__testApplied", CLAIM_LABEL)).toBe(true);
  });
});
