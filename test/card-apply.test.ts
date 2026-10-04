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

/** 一枚全新的干净 ctx：`claimApply(fresh(), …)` 嵌进 expect 就超了 max-nested-calls 的 3 层。 */
const fresh = (): CardApplyCtx => ctxWith(spyCtx());

/** effect 注册即抛错的 ctx（fiber 已销毁 / 重名 effect 等真实成因）。
 *  官方签名两条重载都返回 void，用同一个抛错箭头满足（手法同上面 ctxWith）。 */
function throwingCtx(error: unknown): CardApplyCtx {
  return {
    effect: (() => {
      throw error;
    }) as Context["effect"],
  };
}

describe("claimApply", () => {
  it("首次 claim 成功并挂卸载清理；重复 apply 被拒", () => {
    const spy = spyCtx();
    const ctx = ctxWith(spy);
    expect(claimApply(ctx, "__testApplied", CLAIM_LABEL)).toBe(true);
    // 第二次同 flag：globalThis 标记未复位前拒绝。
    const again = fresh();
    expect(claimApply(again, "__testApplied", CLAIM_LABEL)).toBe(false);
    // 清理函数复位标记后再次 claim 成功。
    const cleanup = spy.calls[0]?.cleanup;
    expect(cleanup).toBeTypeOf("function");
    cleanup?.();
    const afterDispose = fresh();
    expect(claimApply(afterDispose, "__testApplied", CLAIM_LABEL)).toBe(true);
  });

  // 守卫判的是 globalThis 上那一枚标记键，所以下面每条用例各用各的 flag：标记活在
  // 模块级的 globalThis 上，跨用例残留正是"忘记卸载"的真实形状，不清理反而更真。

  it("flag 是守卫的粒度：不同卡片的标记互不干扰", () => {
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__cardB", CLAIM_LABEL)).toBe(true);
    // 各自重复 apply 被自己的标记挡住，而不是被"别的卡片已挂过"连坐。
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(false);
    expect(claimApply(fresh(), "__cardB", CLAIM_LABEL)).toBe(false);
  });

  it("占位判据是 === true，不是「键在不在」：残留的 undefined / false / 非布尔都照常 claim", () => {
    const marker = globalThis as unknown as Record<string, unknown>;
    // 这三种正是本模块自己会留下的痕迹（清理置 undefined）与外部同名键的落法。
    marker["__staleUndefined"] = undefined;
    marker["__staleFalse"] = false;
    marker["__staleString"] = "true";
    // "true" 这个字符串尤其危险：写成 if (marker[flag]) 就会被它挡住，而判据是 === true。
    expect(claimApply(fresh(), "__staleUndefined", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__staleFalse", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__staleString", CLAIM_LABEL)).toBe(true);
    // 反面：只有严格的 true 才算占位，判据放宽一分就成了重复挂载。
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(false);
  });

  it("卸载清理把标记复位成 undefined 而不是删键（删动态键与本仓 lint 基线互斥）", () => {
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__cardC", CLAIM_LABEL)).toBe(true);
    spy.calls[0]?.cleanup?.();
    const marker = globalThis as unknown as Record<string, unknown>;
    // 键还在、值是 undefined：判据 === true 仍然为假，于是这一轮生命周期内还能重新声明。
    expect("__cardC" in marker).toBe(true);
    expect(marker["__cardC"]).toBeUndefined();
    expect(claimApply(fresh(), "__cardC", CLAIM_LABEL)).toBe(true);
  });

  it("ctx.effect 抛错：异常上抛且占位原样退回（守卫不得退化成「这条再也挂不上」）", () => {
    const boom = new Error("effect 注册失败");
    const marker = globalThis as unknown as Record<string, unknown>;
    expect(() => claimApply(throwingCtx(boom), "__cardD", CLAIM_LABEL)).toThrow(boom);
    // 关键在下一行：清理没挂上 ⇒ 没有人会来复位，占位若留着就永久锁死这条 apply。
    expect(marker["__cardD"]).not.toBe(true);
    expect(claimApply(fresh(), "__cardD", CLAIM_LABEL)).toBe(true);
  });

  it("label 原样交给 ctx.effect（生命周期可观测的那一位）", () => {
    const spy = spyCtx();
    claimApply(ctxWith(spy), "__cardE", "dsh-example toolview");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.label).toBe("dsh-example toolview");
    // 清理体确实是挂上去的那一枚（不是空壳），否则卸载复位这条路径根本没被覆盖到。
    expect(spy.calls[0]?.cleanup).toBeTypeOf("function");
  });
});
