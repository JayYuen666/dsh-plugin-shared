// lib/record 单元测试：unknown → Record 的窄化判据与单字段投影。
// 为什么单独测：这两个判据是 SP-D 从 9 个包、27 个文件里回删出来的**唯一真源**（isRecord 实测 37 处、
// fieldOf 13 处逐字同构），一旦这里的短路顺序被改动，波及面是全仓的 unknown 投影链，
// 而各包自己的测试只会间接经过它——四阈值 100 要求三个拒绝子句各被判过一次假。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fieldOf, isRecord } from "../lib/record.ts";

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
});
