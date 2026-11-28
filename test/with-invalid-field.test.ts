// lib/card-ui/invalid.ts 单元测试：越界字段集的四条判据（其中一条是「没变就原样返回」）。
//
// 为什么「原样返回同一枚」要被单独钉：React 靠引用相等跳过重渲，每次 `onInvalidChange`
// 都新建一个 Set 会让整张卡在用户打字过程中反复重渲；而无谓重渲在用例里看不出来（渲染结果
// 一样），只能在这一层用 `===` 判。
//
// 受影响的公共面：本文件只钉 `lib/card-ui/invalid.ts` 的 `withInvalidField`（经
// `lib/card-ui.ts` 汇总、由 `lib/client-entry.ts` 从 `./client` 导出给消费方的卡片）；
// 同步面：`test/index.test.ts`（barrel 与 lib 的对齐）、`test/publish-manifest.test.ts`
// （exports 与 lib 双向）、`CHANGELOG.md` 的 0.2.9 段都已覆盖这一枚导出，本文件补的是
// 行为判据。`onInvalidChange` / `resetToken` 是 `NumberField` 的两位配套接口，本模块是它们
// 共用的判定表。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { withInvalidField } from "../lib/card-ui/invalid.ts";

describe("withInvalidField", () => {
  it("越界时把字段加进去，已提交的值不受影响", () => {
    const next = withInvalidField(new Set(), "resumeDelayMs", true);
    assert.deepEqual([...next], ["resumeDelayMs"]);
  });

  it("恢复合法时把字段移出去，其余字段保留", () => {
    const next = withInvalidField(new Set(["resumeDelayMs", "maxRetries"]), "resumeDelayMs", false);
    assert.deepEqual([...next], ["maxRetries"]);
  });

  it("状态没变时原样返回传入的那一枚（React 靠引用相等跳过重渲）", () => {
    const occupied = new Set(["resumeDelayMs"]);
    assert.equal(withInvalidField(occupied, "resumeDelayMs", true), occupied);
    const empty = new Set<string>();
    assert.equal(withInvalidField(empty, "maxRetries", false), empty);
  });

  it("不改动传入的那一枚：新集合与旧集合互不影响", () => {
    const before = new Set(["maxRetries"]);
    const next = withInvalidField(before, "resumeDelayMs", true);
    assert.notEqual(next, before);
    assert.deepEqual([...before], ["maxRetries"]);
    assert.deepEqual([...next].toSorted(), ["maxRetries", "resumeDelayMs"]);
  });
});
