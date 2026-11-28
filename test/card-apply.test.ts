// test/card-apply.test.ts —— 客户端卡片 apply 幂等保护单测。

import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { claimApply } from "../lib/card-apply.ts";
import type { CardApplyCtx } from "../lib/card-apply.ts";

interface EffectSpy {
  calls: { label: string | undefined; cleanup: (() => void) | undefined }[];
}

/** 三次 claim 都挂同一个 effect 标签：断言只看 flag，标签只是可观测线索。 */
const CLAIM_LABEL = "test: claim";
const EFFECT_FAILURE = "effect 注册失败";

const marker = globalThis as unknown as Record<string, unknown>;

/** 测试自己造的键在用例末尾清掉；claim 正常路径会删键，这里负责清掉断言失败时的残留。 */
function clearFlag(flag: string): void {
  Reflect.deleteProperty(marker, flag);
}

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
  it("首次 claim 成功并挂卸载清理；重复 apply 被拒；清理后恢复缺席", () => {
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__testApplied", CLAIM_LABEL)).toBe(true);
    // 第二次同 flag：globalThis 标记未复位前拒绝。
    expect(claimApply(fresh(), "__testApplied", CLAIM_LABEL)).toBe(false);
    // 清理函数复位标记后再次 claim 成功。
    const cleanup = spy.calls[0]?.cleanup;
    expect(cleanup).toBeTypeOf("function");
    cleanup?.();
    expect(Object.hasOwn(marker, "__testApplied")).toBe(false);
    expect(claimApply(fresh(), "__testApplied", CLAIM_LABEL)).toBe(true);
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

  it("残留的 undefined / false 照常 claim；number / string 是碰撞，明确抛错", () => {
    // 这两种正是本模块自己会留下的痕迹（旧版清理置 undefined）与外部同名键的落法。
    marker["__staleUndefined"] = undefined;
    marker["__staleFalse"] = false;
    expect(claimApply(fresh(), "__staleUndefined", CLAIM_LABEL)).toBe(true);
    expect(claimApply(fresh(), "__staleFalse", CLAIM_LABEL)).toBe(true);

    // 非占位协议的值不覆盖：如果它其实是别的全局属性，认领会把它整段挂载期改写成 token。
    marker["__staleString"] = "true";
    expect(() => claimApply(fresh(), "__staleString", CLAIM_LABEL)).toThrow(/非占位值/u);
    marker["__staleNumber"] = 42;
    expect(() => claimApply(fresh(), "__staleNumber", CLAIM_LABEL)).toThrow(/非占位值/u);
    clearFlag("__staleString");
    clearFlag("__staleNumber");
  });

  it("外部写的 true 仍是占位协议：claim 被拒（对外那一半判据保持不变）", () => {
    marker["__externalTrue"] = true;
    expect(claimApply(fresh(), "__externalTrue", CLAIM_LABEL)).toBe(false);
  });

  it("原型链上的同名 true 不算占位：只认自有槽，且不会落到原型 setter", () => {
    const flag = "__pollutedPrototypeClaim";
    // 形态必须造在**继承链**上：首次 claim 之前 globalThis 上根本没有这个自有键。
    // 不动 Object.prototype 本身（no-extend-native 禁止的就是它，而且污染会留给同进程其余用例）：
    // 把 globalThis 的原型换成一个 `Object.create(Object.prototype)` 的中间层，
    // 其余继承关系原样保留，finally 里换回去。
    const inherited = Object.create(Object.prototype) as Record<string, unknown>;
    inherited[flag] = true;
    const spy = spyCtx();
    Object.setPrototypeOf(globalThis, inherited);
    try {
      expect(claimApply(ctxWith(spy), flag, CLAIM_LABEL)).toBe(true);
      // 占位落在自有键上，所以第二次 apply 才由这条判断拒绝（保护逻辑照常工作，不受原型影响）。
      expect(claimApply(fresh(), flag, CLAIM_LABEL)).toBe(false);
      spy.calls[0]?.cleanup?.();
      expect(Object.hasOwn(marker, flag)).toBe(false);
    } finally {
      Object.setPrototypeOf(globalThis, Object.prototype);
    }
  });

  it("卸载清理删掉本次创建的键，精确恢复 claim 前的缺席状态", () => {
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__cardC", CLAIM_LABEL)).toBe(true);
    expect(Object.hasOwn(marker, "__cardC")).toBe(true);
    spy.calls[0]?.cleanup?.();
    expect(Object.hasOwn(marker, "__cardC")).toBe(false);
    expect(claimApply(fresh(), "__cardC", CLAIM_LABEL)).toBe(true);
  });

  it("claim 前已自有 undefined 时，cleanup 恢复的是自有 undefined，而不是删键", () => {
    marker["__preUndefined"] = undefined;
    expect(Object.hasOwn(marker, "__preUndefined")).toBe(true);
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__preUndefined", CLAIM_LABEL)).toBe(true);
    spy.calls[0]?.cleanup?.();
    expect(Object.hasOwn(marker, "__preUndefined")).toBe(true);
    expect(marker["__preUndefined"]).toBeUndefined();
    clearFlag("__preUndefined");
  });

  it("ctx.effect 抛错：异常上抛且占位原样退回（守卫不得退化成「这条再也挂不上」）", () => {
    const boom = new Error(EFFECT_FAILURE);
    expect(() => claimApply(throwingCtx(boom), "__cardD", CLAIM_LABEL)).toThrow(boom);
    // 关键在下一行：清理没挂上，就没有人会来复位，占位若留着就永久锁死这条 apply。
    expect(Object.hasOwn(marker, "__cardD")).toBe(false);
    expect(claimApply(fresh(), "__cardD", CLAIM_LABEL)).toBe(true);
  });

  it("ctx.effect 抛错时，claim 前已有的自有 descriptor 也按原样恢复", () => {
    const flag = "__effectFailurePrevious";
    marker[flag] = false;
    const boom = new Error(EFFECT_FAILURE);
    expect(() => claimApply(throwingCtx(boom), flag, CLAIM_LABEL)).toThrow(boom);
    expect(marker[flag]).toBe(false);
    expect(Object.hasOwn(marker, flag)).toBe(true);
    clearFlag(flag);
  });

  it("占位写入失败：明确抛错并保留底层 cause", () => {
    const flag = "__defineFailure";
    const defineError = new Error("define failed");
    const originalDefineProperty = Object.defineProperty;
    // 替换内建方法构造 defineProperty 失败态；同步执行、finally 还原，不把补丁留给其他用例。
    Reflect.set(
      Object,
      "defineProperty",
      (target: object, property: PropertyKey, descriptor: PropertyDescriptor) => {
        if (property === flag) {
          throw defineError;
        }
        return originalDefineProperty(target, property, descriptor);
      },
    );
    try {
      let thrown: unknown;
      try {
        claimApply(fresh(), flag, CLAIM_LABEL);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/无法写入占位槽/u);
      expect((thrown as Error).cause).toBe(defineError);
      expect(Object.hasOwn(marker, flag)).toBe(false);
    } finally {
      Reflect.set(Object, "defineProperty", originalDefineProperty);
    }
  });

  it("自有非占位值但不可配置：明确抛错，不覆盖也不留键", () => {
    const flag = "__nonConfigurableStale";
    const originalGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    // claim 前没有同名自有键；用一个不可配置的 undefined descriptor 构造“残留但不可认领”的真实边界。
    Reflect.set(Object, "getOwnPropertyDescriptor", (target: object, property: PropertyKey) =>
      property === flag
        ? { value: undefined, writable: true, enumerable: true, configurable: false }
        : originalGetOwnPropertyDescriptor(target, property),
    );
    try {
      expect(() => claimApply(fresh(), flag, CLAIM_LABEL)).toThrow(/不可配置/u);
      expect(Object.hasOwn(marker, flag)).toBe(false);
    } finally {
      Reflect.set(Object, "getOwnPropertyDescriptor", originalGetOwnPropertyDescriptor);
    }
  });

  it("effect 抛错且占位删不掉：原始注册错误保留，回滚错误挂到 cause", () => {
    const flag = "__rollbackFailure";
    const registerError = new Error(EFFECT_FAILURE);
    const originalDeleteProperty = Reflect.deleteProperty;
    Reflect.set(Reflect, "deleteProperty", (target: object, property: PropertyKey) =>
      property === flag ? false : originalDeleteProperty(target, property),
    );
    try {
      expect(() => claimApply(throwingCtx(registerError), flag, CLAIM_LABEL)).toThrow(
        registerError,
      );
      expect(registerError.cause).toBeInstanceOf(Error);
      expect((registerError.cause as Error).message).toMatch(/不可删除/u);
      // 回滚确实失败：token 仍在，证明这里是“两个错误都可见”而不是静默吞掉。
      expect(marker[flag]).toBeTypeOf("symbol");
    } finally {
      Reflect.set(Reflect, "deleteProperty", originalDeleteProperty);
      clearFlag(flag);
    }
  });

  it("回滚失败且注册错误不可扩展：诊断字段挂不上也不改抛原始错误", () => {
    const flag = "__rollbackFrozen";
    const registerError = new Error(EFFECT_FAILURE);
    Object.freeze(registerError);
    const originalDeleteProperty = Reflect.deleteProperty;
    Reflect.set(Reflect, "deleteProperty", (target: object, property: PropertyKey) =>
      property === flag ? false : originalDeleteProperty(target, property),
    );
    try {
      expect(() => claimApply(throwingCtx(registerError), flag, CLAIM_LABEL)).toThrow(
        registerError,
      );
      expect(registerError.cause).toBeUndefined();
      expect(marker[flag]).toBeTypeOf("symbol");
    } finally {
      Reflect.set(Reflect, "deleteProperty", originalDeleteProperty);
      clearFlag(flag);
    }
  });

  it("回滚失败时不覆盖已有 cause，非 Error 也不包装", () => {
    const existingFlag = "__rollbackExistingCause";
    const nonErrorFlag = "__rollbackNonError";
    const existingError = new Error(EFFECT_FAILURE);
    existingError.cause = "pre-existing";
    const nonError = "register failed";
    const originalDeleteProperty = Reflect.deleteProperty;
    const flags = new Set<PropertyKey>([existingFlag, nonErrorFlag]);
    Reflect.set(Reflect, "deleteProperty", (target: object, property: PropertyKey) =>
      flags.has(property) ? false : originalDeleteProperty(target, property),
    );
    try {
      expect(() => claimApply(throwingCtx(existingError), existingFlag, CLAIM_LABEL)).toThrow(
        existingError,
      );
      expect(existingError.cause).toBe("pre-existing");
      let thrown: unknown;
      try {
        claimApply(throwingCtx(nonError), nonErrorFlag, CLAIM_LABEL);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(nonError);
      expect(marker[existingFlag]).toBeTypeOf("symbol");
      expect(marker[nonErrorFlag]).toBeTypeOf("symbol");
    } finally {
      Reflect.set(Reflect, "deleteProperty", originalDeleteProperty);
      clearFlag(existingFlag);
      clearFlag(nonErrorFlag);
    }
  });

  it("effect 注册路径上标记被改写后抛错 ⇒ catch 不动改写者的值，异常照旧上抛", () => {
    // 退回占位只认自己那个 token：effect 挂不上但槽上已不是本次 claim 的占位时，
    // 按值退回会把改写者的状态一并抹掉。
    const boom = new Error(EFFECT_FAILURE);
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
    expect(marker["__lateDispose"]).toBeTypeOf("symbol");
    // 第三次 apply 仍被拒——新实例的占位没有被旧 disposer 误伤。
    expect(claimApply(fresh(), "__lateDispose", CLAIM_LABEL)).toBe(false);
  });

  it("claim 之前槽上已有的自有值在卸载时按原样恢复，不被抹成 undefined", () => {
    marker["__preExisting"] = false;
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), "__preExisting", CLAIM_LABEL)).toBe(true);
    spy.calls[0]?.cleanup?.();
    expect(marker["__preExisting"]).toBe(false);
    clearFlag("__preExisting");
  });

  it("非默认数据描述符按原 descriptor 恢复（不仅恢复值，也恢复 writable/enumerable）", () => {
    const flag = "__descriptorRestore";
    Object.defineProperty(globalThis, flag, {
      value: false,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    const before = Object.getOwnPropertyDescriptor(globalThis, flag);
    if (before === undefined) {
      throw new Error("测试前置：descriptor 未落下");
    }
    const spy = spyCtx();
    expect(claimApply(ctxWith(spy), flag, CLAIM_LABEL)).toBe(true);
    const during = Object.getOwnPropertyDescriptor(globalThis, flag);
    expect(during?.value).toBeTypeOf("symbol");
    expect(during?.writable).toBe(false);
    expect(during?.enumerable).toBe(false);
    spy.calls[0]?.cleanup?.();
    expect(Object.getOwnPropertyDescriptor(globalThis, flag)).toStrictEqual(before);
    clearFlag(flag);
  });

  it("既有 symbol 占位被拒，且 descriptor 不被改动", () => {
    const flag = "__externalSymbol";
    const existing = Symbol("external-owner");
    marker[flag] = existing;
    expect(claimApply(fresh(), flag, CLAIM_LABEL)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(globalThis, flag)?.value).toBe(existing);
    clearFlag(flag);
  });

  it("自有访问器明确抛错，且不执行 getter/setter", () => {
    const flag = "__accessorCollision";
    let getterCalls = 0;
    let setterCalls = 0;
    Object.defineProperty(globalThis, flag, {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
      },
      set(): void {
        setterCalls += 1;
      },
    });
    try {
      expect(() => claimApply(fresh(), flag, CLAIM_LABEL)).toThrow(/访问器/u);
      expect(getterCalls).toBe(0);
      expect(setterCalls).toBe(0);
      // 抛错前没有写 token，原访问器 descriptor 必须原样还在。
      expect(Object.getOwnPropertyDescriptor(globalThis, flag)?.configurable).toBe(true);
    } finally {
      clearFlag(flag);
    }
  });

  it("原型链上的同名访问器明确抛错，且不执行宿主 setter", () => {
    const flag = "__inheritedAccessor";
    const previousProto = Reflect.getPrototypeOf(globalThis);
    const inherited: object = {};
    Object.setPrototypeOf(inherited, previousProto);
    let getterCalls = 0;
    let setterCalls = 0;
    Object.defineProperty(inherited, flag, {
      configurable: true,
      get() {
        getterCalls += 1;
      },
      set(): void {
        setterCalls += 1;
      },
    });
    Object.setPrototypeOf(globalThis, inherited);
    try {
      expect(() => claimApply(fresh(), flag, CLAIM_LABEL)).toThrow(/访问器/u);
      expect(getterCalls).toBe(0);
      expect(setterCalls).toBe(0);
      expect(Object.hasOwn(marker, flag)).toBe(false);
    } finally {
      Object.setPrototypeOf(globalThis, previousProto);
    }
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

describe("claimApply + 真实 Cordis 生命周期", () => {
  it("apply 在 claim 之后抛错：Cordis 跑清理、槽复位；update 重试成功", async () => {
    const flag = "__cordisApplyFailure";
    clearFlag(flag);
    const ctx = new Context();
    let attempts = 0;
    const fiber = ctx.plugin({
      name: "card-apply-probe",
      apply(inner: Context): void {
        attempts += 1;
        if (!claimApply(inner, flag, "probe: claim")) {
          throw new Error("claim rejected");
        }
        if (attempts === 1) {
          throw new Error("mount step failed");
        }
      },
    });
    await expect(fiber.await()).rejects.toThrow("mount step failed");
    // Cordis 的 _unload 已经跑过 claim 的 disposer：占位必须精确回到缺席，
    // 而不是把 undefined 键留下来（下一句同时钉住 hasOwn 与值）。
    expect(Object.hasOwn(globalThis, flag)).toBe(false);
    await fiber.update(undefined, true);
    await fiber.await();
    expect(attempts).toBe(2);
    expect(Object.getOwnPropertyDescriptor(globalThis, flag)?.value).toBeTypeOf("symbol");
    await fiber.dispose();
    expect(Object.hasOwn(globalThis, flag)).toBe(false);
  });

  it("已卸载 ctx 上 claimApply 抛 INACTIVE_EFFECT，且不留下占位", async () => {
    const flag = "__cordisDisposedCtx";
    clearFlag(flag);
    const ctx = new Context();
    const fiber = ctx.plugin({
      name: "card-apply-disposed-probe",
      apply(): void {
        // 这个插件自身不做 claim；下面用它的 ctx 在 dispose 之后直接调用。
      },
    });
    await fiber.await();
    await fiber.dispose();
    expect(() => claimApply(fiber.ctx, flag, "probe: disposed")).toThrow(
      /INACTIVE_EFFECT|inactive/iu,
    );
    // claim 先写 token，ctx.effect 抛错后 catch 回滚：不能留下一个无人清理的占位。
    expect(Object.hasOwn(globalThis, flag)).toBe(false);
  });
});
