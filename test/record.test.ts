// lib/record 单元测试：unknown → Record 的窄化判据与单字段投影。
// 为什么单独测：这两个判据是从各包逐字同构的重复定义里收敛出来的**唯一真源**，
// 一旦这里的短路顺序被改动，波及面是全仓的 unknown 投影链，
// 而各包自己的测试只会间接经过它——四阈值 100 要求三个拒绝子句各被判过一次假。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { fieldOf, hasMethods, isRecord } from "../lib/record.ts";

/** 可调用样本：不用 `() => undefined`，基线的 unicorn(no-useless-undefined) 判红那个字面量。 */
const callable = (): string => "ok";

describe("isRecord（unknown → Record 的窄化判据）", () => {
  it("普通对象为真，且能把 unknown 收成 Record<string, unknown>", () => {
    const value: unknown = { a: 1 };
    assert.equal(isRecord(value), true);
    if (isRecord(value)) {
      assert.equal(value["a"], 1);
    }
  });

  it("三种非记录形态各判一次假：null / 数组 / 非 object（逐个短路子句）", () => {
    assert.equal(isRecord(null), false, "第 2 子句：object 但为 null");
    assert.equal(isRecord([1, 2]), false, "第 3 子句：object 非 null 但是数组");
    for (const notObject of ["s", 7, undefined, true, Symbol("x")]) {
      assert.equal(isRecord(notObject), false, "第 1 子句：typeof 非 object");
    }
  });
});

describe("fieldOf（从 unknown 投影单个字段）", () => {
  it("记录 → 取值（含缺失键 → undefined）", () => {
    assert.equal(fieldOf({ a: 1 }, "a"), 1);
    assert.equal(fieldOf({}, "missing"), undefined);
  });

  it("非记录一律 undefined（字符串的索引访问不算取值）", () => {
    assert.equal(fieldOf("ab", "0"), undefined);
    assert.equal(fieldOf(null, "a"), undefined);
    assert.equal(fieldOf(["x"], "0"), undefined);
  });

  it("取值走原型链 —— 这条是承重的：类实例的能力探测靠它，改成 hasOwn 会打断三个包", () => {
    // 消费方的能力探测读的是**原型上的方法**，不是自有键。具体调用点（本文件不会被发布，
    // 所以包名可以写在这儿；lib/record.ts 的声明 JSDoc 里不能写，会随 .d.ts 发出去）：
    //   typeof fieldOf(settings, "describe") === "function"
    //     quality-gate/host.ts、lesson-loop/host.ts
    //   hasMethods(fieldOf(value, "timer"), ["timeout"])
    //   hasMethods(fieldOf(value, "settings"), ["describe", "mutate"])
    //     session-rescue/host.ts
    //   typeof fieldOf(session, "snapshotEvents") === "function"
    //     session-rescue/host.ts
    // cordis 服务对象的方法都在原型上。把它改成 Object.hasOwn，上面每一处都会判否，
    // 各消费包随即认不出合法的 cordis 服务——而误判的表现是「静默返回 false」，不是报错。
    // 用显式原型而不是 class：cordis 服务对象本来就是「方法挂在原型上的普通对象」，
    // 这比 class 实例更贴近真实形状，也免掉 class 成员那两条 lint。
    const proto = { describe: (): string => "ok" };
    const service: unknown = Object.create(proto);
    assert.equal(Object.hasOwn(service as object, "describe"), false, "前提：它本来就不是自有键");
    assert.equal(typeof fieldOf(service, "describe"), "function", "能力探测必须仍然成立");
    assert.equal(typeof fieldOf({}, "toString"), "function");

    // 代价照实钉住：键名指向原型成员时取到的就是原型成员，调用方不得默认那是数据字段。
    assert.equal(fieldOf({}, "__proto__"), Object.prototype);
    assert.equal(fieldOf({}, "constructor"), Object);
    // 自有键优先于原型键（这才是 JSON 载荷真正携带的那一枚）。
    assert.equal(fieldOf(JSON.parse('{"__proto__":1}'), "__proto__"), 1);
    // 没有原型的对象取不到原型成员，如实给 undefined。
    assert.equal(fieldOf(Object.create(null), "__proto__"), undefined);
  });

  it("跨 realm 判定成立（判据不是 instanceof / 本域 Array）", () => {
    // iframe、vm 上下文、worker 造出来的对象都不是本 realm 的构造器产物。若判据写成
    // value instanceof Object 或 value instanceof Array，这两种形状都会判错，而客户端
    // 卡片那条腿拿到的正是外来 realm 的载荷。
    const foreignObject: unknown = runInNewContext("({ a: 1 })");
    assert.equal(isRecord(foreignObject), true);
    assert.equal(fieldOf(foreignObject, "a"), 1);
    const foreignArray: unknown = runInNewContext("[1, 2]");
    assert.equal(isRecord(foreignArray), false, "Array.isArray 跨 realm 成立，instanceof 不成立");
    assert.equal(fieldOf(foreignArray, "0"), undefined);
  });
});

describe("hasMethods（服务面校验）", () => {
  it("非 Record 的五种形状全部拒绝", () => {
    for (const value of [null, undefined, 1, "x", []]) {
      assert.equal(hasMethods(value, ["kill"]), false, `不该认 ${String(value)}`);
    }
  });

  it("清单里有一个成员不可调用就整体拒绝", () => {
    assert.equal(hasMethods({ kill: callable, read: "x" }, ["kill", "read"]), false);
  });

  it("全部可调用才算服务面", () => {
    assert.equal(hasMethods({ kill: callable, read: callable }, ["kill", "read"]), true);
  });

  it("空清单只验「是个对象」——调用方据此把「没有方法要验」与「服务不在」分开", () => {
    assert.equal(hasMethods({}, []), true);
  });

  it("原型链的默认成员（Object.prototype 一类）不算服务实现：普通对象冒充不了服务面", () => {
    // 判据是身份（解析到的函数正是 Object.prototype 上那一枚才排除），不是「在原型链上」：
    // 类/中间原型上的真实实现照常可识别，cordis 方法挂原型那条承重面不受影响。
    assert.equal(hasMethods({}, ["toString"]), false);
    assert.equal(hasMethods({}, ["constructor"]), false);
    const proto = { toString: (): string => "ok" };
    assert.equal(hasMethods(Object.create(proto), ["toString"]), true);
  });

  it("被测对象带抛错 getter / Proxy 陷阱 ⇒ 按「能力不存在」处理，异常不冒泡", () => {
    // fieldOf / hasMethods 的调用点形如 `typeof fieldOf(x, "describe") === "function"`，
    // 周围没有 try/catch：探测读一次抛错就会把整条表达式炸掉，把「能力不存在」升级成流程崩溃。
    const hostile: unknown = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "boom") {
            throw new Error("探测期间抛错");
          }
          return key;
        },
      },
    );
    assert.equal(fieldOf(hostile, "boom"), undefined);
    assert.equal(hasMethods(hostile, ["boom"]), false);
  });
});
