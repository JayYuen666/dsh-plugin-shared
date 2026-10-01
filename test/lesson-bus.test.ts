// lib/lesson-bus.ts 单测：两条失败面（同步抛错 / 异步拒绝）都要落到同一个出口，
// 而「成功」「返回非对象」「返回没有 then 的对象」都不该被当成失败。
import { describe, expect, it } from "vitest";
import { settleLessonCall } from "../lib/lesson-bus.ts";

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
    settleLessonCall(() => Promise.reject(new Error("async down")), sink.take);
    await Promise.resolve();
    expect(sink.reasons).toStrictEqual([expect.objectContaining({ message: "async down" })]);
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
});
