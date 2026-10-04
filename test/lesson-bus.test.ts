// lib/lesson-bus.ts 单测：两条失败面（同步抛错 / 异步拒绝）都要落到同一个出口，
// 而「成功」「返回非对象」「返回没有 then 的对象」都不该被当成失败。
import { setImmediate as yieldToMacrotask } from "node:timers/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { settleLessonCall } from "../lib/lesson-bus.ts";
import { logged } from "./setup-logs.ts";

interface Sink {
  readonly reasons: unknown[];
  readonly take: (reason: unknown) => void;
}

/** 收集 onFailure 收到的原因（不用 vi.fn：它推断成值返回，会撞 strict-void-return）。 */
function collector(): Sink {
  const reasons: unknown[] = [];
  const take = (reason: unknown): void => {
    reasons.push(reason);
  };
  return { reasons, take };
}

/** 异步拒绝面共用的失败文案，避免同一字面量散在多处。 */
const ASYNC_DOWN = "async down";

/** 没给 onRejected 时的兜底出口：await 只接 fulfil 一路，拒绝路得自己造。 */
const rejectDirectly = (reason: unknown): never => {
  throw reason;
};

/**
 * 放完整条微任务链再回来。`await` 一个 thenable 要经三跳：排队调用 `then` → 拒绝 → catch 里
 * 交给出口。固定次数的 `await Promise.resolve()` 数不准，用一个宏任务边界把队列排空。
 */
async function flushMicrotasks(): Promise<void> {
  await yieldToMacrotask();
}

/** 空壳可调用体：被测的只有 then 的存在与否，以及它把拒绝交给哪个出口。 */
const callableShell = (): void => {
  // 见上方说明：函数体本身不参与判定
};

/**
 * 一个**函数**同时也是 thenable。函数型 thenable 是脚手架事故的高发形状，本仓 lint 默认禁它
 * （本包已就这一个用例文件按文件收窄关闭，见 oxlint.config.ts）。但 `isThenable` 必须认它——
 * 漏判的方向是不安全的：不挂出口的 rejection 会变成进程级未处理拒绝。
 */
function functionThenable(): (() => void) & PromiseLike<never> {
  const thenable = callableShell;
  Object.defineProperty(thenable, "then", {
    value: (_onFulfilled?: unknown, onRejected?: (reason: unknown) => unknown): unknown =>
      (onRejected ?? rejectDirectly)(new Error("function-thenable down")),
  });
  return thenable as (() => void) & PromiseLike<never>;
}

/** 失败收口自己抛错——用来验证它不会把异常分叉到调用方或变成未处理拒绝。 */
const explodingSink = (): never => {
  throw new Error("onFailure 自己炸了");
};

describe("settleLessonCall", () => {
  it("调用同步抛错 ⇒ onFailure 收到那个原因", () => {
    const sink = collector();
    settleLessonCall(() => {
      throw new Error("bus down");
    }, sink.take);
    expect(sink.reasons).toStrictEqual([expect.objectContaining({ message: "bus down" })]);
  });

  it("返回 rejected Promise ⇒ 拒绝原因进 onFailure，不留未处理拒绝", async () => {
    const sink = collector();
    settleLessonCall(() => Promise.reject(new Error(ASYNC_DOWN)), sink.take);
    await Promise.resolve();
    expect(sink.reasons).toStrictEqual([expect.objectContaining({ message: ASYNC_DOWN })]);
  });

  it("返回 resolved Promise ⇒ 不算失败", async () => {
    const sink = collector();
    settleLessonCall(() => Promise.resolve("persisted"), sink.take);
    await Promise.resolve();
    expect(sink.reasons).toStrictEqual([]);
  });

  it("返回非对象或 null ⇒ 按成功处理（含 typeof 那一支与 null 单独判那一支）", () => {
    const sink = collector();
    for (const value of [undefined, "rules-not-persisted", null, 0]) {
      settleLessonCall(() => value, sink.take);
    }
    expect(sink.reasons).toStrictEqual([]);
  });

  it("返回没有 then 方法的对象 ⇒ 不当成可等待，也不挂出口", () => {
    const sink = collector();
    settleLessonCall(() => ({ receipt: "persisted" }), sink.take);
    expect(sink.reasons).toStrictEqual([]);
  });

  it("函数型 thenable 也算可等待——漏判会让 rejection 变成进程级未处理拒绝", async () => {
    const reasons: unknown[] = [];
    // 传的是**工厂**：first 参数是「怎么拿到返回值」的函数，不是返回值本身
    settleLessonCall(functionThenable, (reason) => {
      reasons.push(reason);
    });
    await flushMicrotasks();
    expect(reasons).toHaveLength(1);
  });

  it("onFailure 自己抛错时两条失败面都不外抛（同步抛给调用方 / 异步变未处理拒绝）", async () => {
    // 同步抛错面：settleLessonCall 自身不把异常抛给调用方
    expect(() => {
      settleLessonCall(() => {
        throw new Error("call down");
      }, explodingSink);
    }).not.toThrow();
    // 异步拒绝面：不得变成未处理拒绝
    expect(() => {
      settleLessonCall(() => Promise.reject(new Error(ASYNC_DOWN)), explodingSink);
    }).not.toThrow();
    await flushMicrotasks();
    // 两条失败面都必须**出声**：收口自己抛错若被静默吞掉，排查时连"它炸过"都看不到。
    // 账本（test/setup-logs.ts）把 console 接管成记录，所以这里既断言得到、又不会把栈
    // 喷进测试报告——那正是这条用例当初留下的噪点。
    const records = logged();
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.level).toBe("error");
      expect(record.text).toContain("onFailure threw:");
      // 实参里带着收口自己抛的那个 Error（它不在拼平的首参里）。
      expect((record.extra[0] as Error).message).toBe("onFailure 自己炸了");
    }
  });

  it("then 是敌意 getter（读它就抛）⇒ 这次探测本身算一次失败，落进同一个出口", async () => {
    // isThenable 用 Reflect.get 读 then，而那次读就发生在 settleLessonCall 的 try 里，
    // 于是"探测 thenable"失败被同步那条路接住。方向是安全的：宁可报一次失败，
    // 也不能因为读不到 then 就判定"不是可等待对象"放过去——放过去等于不挂 rejection 出口。
    const sink = collector();
    const hostile: object = {
      get then(): never {
        throw new Error("then getter 炸了");
      },
    };
    expect(() => {
      settleLessonCall(() => hostile, sink.take);
    }).not.toThrow();
    expect(sink.reasons).toHaveLength(1);
    expect(String(sink.reasons[0])).toContain("then getter 炸了");
    await flushMicrotasks();
    // 排空微任务后仍是那一条：不得二次投递。
    expect(sink.reasons).toHaveLength(1);
  });

  it("另一份 realm 的 Promise 拒绝也接得住（判据认 then，不认 instanceof）", async () => {
    // 模块注释点名的成因：宿主给的 Promise 可能来自 iframe / worker / vm 上下文，
    // 那时 instanceof Promise 恒为 false，isThenable 若靠它判就会漏挂出口。
    const sink = collector();
    const foreign: unknown = runInNewContext("Promise.reject(new Error(1))");
    settleLessonCall(() => foreign, sink.take);
    await flushMicrotasks();
    expect(sink.reasons).toHaveLength(1);
    expect((sink.reasons[0] as Error).message).toBe("1");
  });
});
