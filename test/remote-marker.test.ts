// test/remote-marker.test.ts —— 程序化 Remote 标记的判据：标记真的落到原型上、
// `remoteMethods()` 读得出来、且形状与官方装饰器一致。
//
// 为什么必须有一条「真读得出来」的判据：`markRemote` 的全部作用是**副作用**（往原型写描述符），
// 返回值是 undefined。只断言「调用没抛错」等于什么都没验 —— 原型没标上时网关照样起得来，
// 只是方法不出现在命名空间里，症状是卡片上一片空白而不是一条报错。
//
// 为什么这里不写 `@Remote(...)` 装饰器语法作对照：本仓的测试流水线没有挂装饰器降级插件
// （shared 不能消费自己尚未发布的 `./lib/decorator-lowering`），带装饰器语法的文件在 vitest
// 里会直接 `SyntaxError` 连加载都失败。等价性由别处兜：三个消费仓（zvec-grep / lesson-loop /
// scrapling）迁移到本助手后各自的 remote 测试都断言「标记集合深等于写死的方法名集合」，
// 而 dsh-rtk 走装饰器语法的那条路有自己的同名断言 —— 两条路的产出一致由那两个面共同钉住。
//
// 夹具用对象字面量而不是 class：`markRemote` 要的只是一枚**会当原型用**的对象，
// `Object.create(字面量)` 出来的实例与 `new 类()` 在原型链上等价，而字面量不受
// `max-classes-per-file` 与 `class-methods-use-this` 约束（本文件只需一个真类做继承用例）。
import assert from "node:assert/strict";
import { beforeAll, describe, it } from "vitest";
import { TypertRemoteService, remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import type { Context } from "@deepseek-ai/cordis";
import { markRemote } from "../lib/remote-marker.ts";

/** 最小的被标记原型：alpha / beta 会被标记，gamma 刻意不标（用来证「没标的读不到」）。 */
const probePrototype = {
  alpha(): number {
    return 1;
  },
  beta(): string {
    return "b";
  },
  gamma(): boolean {
    return true;
  },
};

// `instanceOf(obj)` 的 lib 签名返回 `any`（它的入参是 `object | null`，返回值无法静态推断），
// 所以这里统一转一次；测试面关掉了 `no-unsafe-type-assertion`，生产侧不这么写。
const instanceOf = (prototype: object): object => Object.create(prototype) as object;

const markedNames = (subject: object): string[] =>
  remoteMethods(subject)
    .map((marker) => marker.method)
    .toSorted();

describe("markRemote", () => {
  beforeAll(() => {
    markRemote(probePrototype, "alpha");
    markRemote(probePrototype, "beta");
  });

  it("标记落到原型上，remoteMethods 读得出被标的两枚、漏标的那枚不在", () => {
    assert.deepEqual(markedNames(instanceOf(probePrototype)), ["alpha", "beta"]);
  });

  it("标记的是一元直接调用形态", () => {
    const markers = remoteMethods(instanceOf(probePrototype));
    assert.notEqual(markers.length, 0, "一条标记都没读到，后面的断言就没有对象了");
    for (const marker of markers) {
      assert.equal(marker.invocation.kind, "direct");
      assert.equal(marker.mode, undefined);
      assert.equal(marker.exportName, undefined);
    }
  });

  it("标记落在原型上而不是实例上（新实例无需重新标记）", () => {
    // 两个不同实例读出同一份标记，说明标记在原型层；若哪天 Remote 改成写实例自有属性，
    // 第二枚实例就读不到了。
    assert.deepEqual(markedNames(instanceOf(probePrototype)), ["alpha", "beta"]);
    assert.deepEqual(markedNames(instanceOf(probePrototype)), ["alpha", "beta"]);
  });

  it("调用一个没有实现的方法名时，把该名字原样标上（不静默跳过）", () => {
    // 官方装饰器的行为是「标就算数」，不校验被标的东西是不是函数。这里钉住同一条：
    // 拼错方法名时症状是命名空间里多一枚调不通的方法，而不是标记悄悄消失。
    const mistyped = {};
    markRemote(mistyped, "ghost");
    assert.deepEqual(markedNames(instanceOf(mistyped)), ["ghost"]);
  });

  it("同一原型上重复标记同一枚方法是幂等的", () => {
    const repeat = {
      alpha(): number {
        return 1;
      },
    };
    markRemote(repeat, "alpha");
    markRemote(repeat, "alpha");
    assert.deepEqual(markedNames(instanceOf(repeat)), ["alpha"]);
  });

  it("能和真的 TypertRemoteService 子类一起用（服务的构造函数仍由 super 注册）", () => {
    class RealService extends TypertRemoteService {
      public constructor(ctx: Context) {
        super(ctx, "probeRealService");
      }

      // oxlint-disable-next-line eslint/class-methods-use-this -- 本用例只验「真子类也能被标记」，方法体本身没有语义
      public ping(): string {
        return "pong";
      }
    }
    markRemote(RealService.prototype, "ping");
    assert.deepEqual(markedNames(instanceOf(RealService.prototype)), ["ping"]);
  });
});
