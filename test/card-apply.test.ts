// test/card-apply.test.ts —— 客户端卡片 apply 幂等保护单测。

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
 * 测试数据的 ctx 类型就是生产的 `CardApplyCtx`（其 `effect` 绑官方 `Context['effect']`）——
 * 不再自写一条 `(factory: () => (() => void) | undefined, label?) => void`：那条比官方
 * 宽（`SyncEffect` 不收 undefined），按 contravariance 反而**装不进**官方 ctx，
 * 正是三个卡片包各自出现 TS2345 的同一处。
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

/** 一个全新的干净 ctx：`claimApply(fresh(), …)` 嵌进 expect 就超了 max-nested-calls 的 3 层。 */
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

  // 保护逻辑判的是 globalThis 上那一个标记键，所以下面每条用例各用各的 flag：标记活在
  // 模块级的 globalThis 上，跨用例残留正是"忘记卸载"的真实形态，不清理反而更接近真实。

  it("flag 是守卫的粒度：不同卡片的标记互不干扰", () => {
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__cardB", CLAIM_LABEL)).toBe(true);
    // 各自重复 apply 被自己的标记拒绝，而不是被"别的卡片已挂过"牵连。
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(false);
    expect(claimApply(fresh(), "__cardB", CLAIM_LABEL)).toBe(false);
  });

  it("占位判据是「自有键上的 true 或 claim symbol」：残留的 undefined / false / 非布尔都照常 claim", () => {
    const marker = globalThis as unknown as Record<string, unknown>;
    // 这三种正是本模块自己会留下的痕迹（清理置 undefined）与外部同名键的落法。
    marker["__staleUndefined"] = undefined;
    marker["__staleFalse"] = false;
    marker["__staleString"] = "true";
    // "true" 这个字符串尤其危险：写成 if (marker[flag]) 就会误判，而实际判断比它严格。
    expect(claimApply(fresh(), "__staleUndefined", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__staleFalse", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__staleString", CLAIM_LABEL)).toBe(true);
    // 反面：只有严格的 true / symbol 才算占位，判断放宽一分就成了重复挂载。
    expect(claimApply(fresh(), "__cardA", CLAIM_LABEL)).toBe(false);
  });

  it("外部写的 true 仍是占位协议：claim 被拒（对外那一半判据保持不变）", () => {
    const marker = globalThis as unknown as Record<string, unknown>;
    marker["__externalTrue"] = true;
    expect(claimApply(fresh(), "__externalTrue", CLAIM_LABEL)).toBe(false);
  });

  it("原型污染不算占位：原型链上同名 true 不得让卡片静默不挂载", () => {
    const flag = "__pollutedPrototypeClaim";
    // 形态必须造在**继承链**上：首次 claim 之前 globalThis 上根本没有这个自有键。
    // 不动 Object.prototype 本身（no-extend-native 禁止的就是它，而且污染会留给同进程其余用例）：
    // 把 globalThis 的原型换成一个 `Object.create(Object.prototype)` 的中间层，
    // 其余继承关系原样保留，finally 里换回去。
    const inherited = Object.create(Object.prototype) as Record<string, unknown>;
    inherited[flag] = true;
    Object.setPrototypeOf(globalThis, inherited);
    try {
      expect(claimApply(fresh(), flag, CLAIM_LABEL)).toBe(true);
      // 占位落在自有键上，所以第二次 apply 才由这条判断拒绝（保护逻辑照常工作，不受原型影响）。
      expect(claimApply(fresh(), flag, CLAIM_LABEL)).toBe(false);
    } finally {
      Object.setPrototypeOf(globalThis, Object.prototype);
    }
  });

  it("卸载清理把标记复位成 undefined 而不是删键（删动态键与本仓 lint 基线互斥）", () => {
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__cardC", CLAIM_LABEL)).toBe(true);
    spy.calls[0]?.cleanup?.();
    const marker = globalThis as unknown as Record<string, unknown>;
    // 键还在、值是 undefined：判断 === true 仍然为 false，于是这一轮生命周期内还能重新声明。
    expect("__cardC" in marker).toBe(true);
    expect(marker["__cardC"]).toBeUndefined();
    expect(claimApply(fresh(), "__cardC", CLAIM_LABEL)).toBe(true);
  });

  it("ctx.effect 抛错：异常上抛且占位原样退回（守卫不得退化成「这条再也挂不上」）", () => {
    const boom = new Error("effect 注册失败");
    const marker = globalThis as unknown as Record<string, unknown>;
    expect(() => claimApply(throwingCtx(boom), "__cardD", CLAIM_LABEL)).toThrow(boom);
    // 关键在下一行：清理没挂上，就没有人会来复位，占位若留着就永久锁死这条 apply。
    expect(marker["__cardD"]).not.toBe(true);
    expect(claimApply(fresh(), "__cardD", CLAIM_LABEL)).toBe(true);
  });

  it("effect 注册路径上标记被改写后抛错 ⇒ catch 不动改写者的值，异常照旧上抛", () => {
    // 退回占位只认自己那个 token：effect 挂不上但槽上已不是本次 claim 的占位时，
    // 按值退回会把改写者的状态一并抹掉。
    const marker = globalThis as unknown as Record<string, unknown>;
    const boom = new Error("effect 注册失败");
    const hostile: CardApplyCtx = {
      effect: (() => {
        marker["__hostileEffect"] = true;
        throw boom;
      }) as Context["effect"],
    };
    expect(() => claimApply(hostile, "__hostileEffect", CLAIM_LABEL)).toThrow(boom);
    expect(marker["__hostileEffect"]).toBe(true);
  });

  it("label 原样交给 ctx.effect（生命周期可观测的那一位）", () => {
    const spy = spyCtx();
    claimApply(ctxWith(spy), "__cardE", "dsh-example toolview");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.label).toBe("dsh-example toolview");
    // 清理函数确实是挂上去的那一个（不是空壳），否则卸载复位这条路径根本没被覆盖到。
    expect(spy.calls[0]?.cleanup).toBeTypeOf("function");
  });

  it("旧 disposer 迟到/被重复调用时清不掉新实例的占位（按 token 认领，不按值清）", () => {
    // HMR / 重复加载不保证 disposer 的时序与次数：旧实例的清理晚于新实例 claim 执行时，
    // 若按值清会把新占位抹掉，第三次 apply 就能拿到声明权——重复挂载正是保护逻辑要堵住的路。
    const firstSpy = spyCtx();
    expect(claimApply(ctxWith(firstSpy), "__lateDispose", CLAIM_LABEL)).toBe(true);
    firstSpy.calls[0]?.cleanup?.();
    const secondSpy = spyCtx();
    expect(claimApply(ctxWith(secondSpy), "__lateDispose", CLAIM_LABEL)).toBe(true);
    // 旧实例的清理被再次调用：此刻槽上已是新实例的 token。
    firstSpy.calls[0]?.cleanup?.();
    const marker = globalThis as unknown as Record<string, unknown>;
    expect(marker["__lateDispose"]).toBeTypeOf("symbol");
    // 第三次 apply 仍被拒——新实例的占位没有被旧 disposer 误伤。
    expect(claimApply(fresh(), "__lateDispose", CLAIM_LABEL)).toBe(false);
  });

  it("claim 之前槽上已有的自有值在卸载时按原样恢复，不被抹成 undefined", () => {
    const marker = globalThis as unknown as Record<string, unknown>;
    marker["__preExisting"] = false;
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__preExisting", CLAIM_LABEL)).toBe(true);
    spy.calls[0]?.cleanup?.();
    expect(marker["__preExisting"]).toBe(false);
  });

  it("flag 命中 Object.prototype 的成员即抛：__proto__ 一类进不来", () => {
    // __proto__ 写不进自有属性（setter 忽略非对象值），函数却返回 true——保护从此永远失灵；
    // __defineGetter__ 一类是 Object.prototype 的自有成员，落下去会遮蔽同名全局方法。
    expect(() => claimApply(fresh(), "__proto__", CLAIM_LABEL)).toThrow(/flag/u);
    expect(() => claimApply(fresh(), "__defineGetter__", CLAIM_LABEL)).toThrow(/flag/u);
    expect(() => claimApply(fresh(), "constructor", CLAIM_LABEL)).toThrow(/flag/u);
    expect(() => claimApply(fresh(), "", CLAIM_LABEL)).toThrow(/flag/u);
  });

  it("flag 不带 __ 前缀照常可用（消费卡里存在无前缀的实际键，前缀是惯例不是判据）", () => {
    expect(claimApply(fresh(), "someCardApplied", CLAIM_LABEL)).toBe(true);
  });
});
