// test/card-form.test.ts —— 卡片草稿层的纯函数骨架。
//
// 两件事必须钉住：bounds 的两个缺席方向不能互相冒充；touched 的读取必须是自有键，
// `field in touched` 会把 constructor/__proto__ 这类原型成员当草稿。

import { describe, expect, it } from "vitest";
import { effectiveField, numberBoundsOf, withDraftField } from "../lib/card-form.ts";

describe("numberBoundsOf", () => {
  it("两个方向都声明时原样返回", () => {
    expect(numberBoundsOf({ minValue: 1, maxValue: 10 })).toStrictEqual({ min: 1, max: 10 });
  });

  it("单个方向声明时只返回那一侧，不编造另一侧", () => {
    expect(numberBoundsOf({ minValue: 2, maxValue: null })).toStrictEqual({ min: 2 });
    expect(numberBoundsOf({ minValue: null, maxValue: 8 })).toStrictEqual({ max: 8 });
  });

  it("两个方向都缺席时返回空对象", () => {
    expect(numberBoundsOf({ minValue: null, maxValue: null })).toStrictEqual({});
  });

  it("fallback 只补缺席方向，已声明的方向不覆盖", () => {
    expect(numberBoundsOf({ minValue: 3, maxValue: null }, { min: 1, max: 99 })).toStrictEqual({
      min: 3,
      max: 99,
    });
    expect(numberBoundsOf({ minValue: null, maxValue: null }, { min: 1, max: 99 })).toStrictEqual({
      min: 1,
      max: 99,
    });
  });
});

describe("withDraftField", () => {
  it("返回新记录，不改入参", () => {
    const before = { model: "old" };
    const after = withDraftField(before, "model", "new");
    expect(after).toStrictEqual({ model: "new" });
    expect(before).toStrictEqual({ model: "old" });
  });

  it("__proto__ 字段落成自有数据属性，不污染原型", () => {
    const next = withDraftField({}, "__proto__", { polluted: true });
    expect(Object.hasOwn(next, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(next["polluted"]).toBeUndefined();
  });
});

describe("effectiveField", () => {
  it("自有草稿优先；显式 undefined 也算用户清空", () => {
    expect(effectiveField({ model: "draft" }, { model: "snapshot" }, "model")).toBe("draft");
    expect(effectiveField({ model: undefined }, { model: "snapshot" }, "model")).toBeUndefined();
  });

  it("缺席才回落快照，继承键不算草稿", () => {
    expect(effectiveField({}, { model: "snapshot" }, "model")).toBe("snapshot");
    // `constructor` 在 `{}` 上沿原型链可读；`field in touched` 会误判成草稿。
    expect(effectiveField({}, { constructor: "snapshot" }, "constructor")).toBe("snapshot");
    expect(
      effectiveField({ constructor: "draft" }, { constructor: "snapshot" }, "constructor"),
    ).toBe("draft");
  });
});
