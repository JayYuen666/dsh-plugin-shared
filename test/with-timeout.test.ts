// test/with-timeout.test.ts —— 限时竞速骨架的单元判据。
//
// 「到点只是不再等、底层操作继续跑」与「计时器两端都清」的语义由消费仓的领域用例
// 各自覆盖；这里钉骨架本体的三类结局与拒绝值来源（回调构造的 Error 原样成为拒绝值）。
import { describe, expect, it } from "vitest";
import { raceTimeout } from "../lib/with-timeout.ts";

describe("raceTimeout", () => {
  it("操作先到：交回操作的结果，且不触发拒绝值构造", async () => {
    let constructed = false;
    const done = Promise.withResolvers<string>();
    setTimeout(() => {
      done.resolve("done");
    }, 0);
    const value = await raceTimeout(done.promise, 5000, () => {
      constructed = true;
      return new Error("timeout");
    });
    expect(value).toBe("done");
    expect(constructed).toBe(false);
  });

  it("到点先到：以回调构造的 Error 拒绝，原操作的最终结果被放弃", async () => {
    const error = new Error("超时");
    const late = Promise.withResolvers<string>();
    setTimeout(() => {
      late.resolve("late");
    }, 20);
    await expect(raceTimeout(late.promise, 5, () => error)).rejects.toBe(error);
  });

  it("原操作拒绝：拒绝原样透传（不是超时形状）", async () => {
    const failure = new Error("boom");
    await expect(
      raceTimeout(Promise.reject(failure), 5000, () => new Error("timeout")),
    ).rejects.toBe(failure);
  });
});
