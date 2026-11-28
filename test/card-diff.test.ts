// test/card-diff.test.ts —— touched 层与快照的差异投影。
//
// 固定的是"值语义"这一条：引用相等会把等值数组判成没改、把重排的同内容数组判成改了，
// 两种都会让用户看到不该出现的"有改动"提示或丢掉该出现的。

import { describe, expect, it } from "vitest";
import { diffTouched, formValueEquals } from "../lib/card-diff.ts";

describe("diffTouched", () => {
  it("值相同就不算改动，哪怕两边不是同一枚对象", () => {
    expect(diffTouched({ model: ["a", "b"] }, { model: ["a", "b"] })).toStrictEqual([]);
  });

  it("值不同才进差异，且只报 touched 里出现过的键", () => {
    expect(diffTouched({ model: "deep", temp: 0.2 }, { model: "other", unused: 1 })).toStrictEqual([
      "model",
      "temp",
    ]);
  });

  it("undefined 与缺失等价：草稿层显式写 undefined 不算改动", () => {
    expect(diffTouched({ temp: undefined }, { temp: null })).toStrictEqual([]);
    expect(diffTouched({ temp: undefined }, {})).toStrictEqual([]);
  });

  it("null 与缺失也等价：`?? null` 把两边折成同一个值", () => {
    expect(diffTouched({ temp: null }, {})).toStrictEqual([]);
    expect(diffTouched({ temp: null }, { temp: 0 })).toStrictEqual(["temp"]);
  });

  // 下面几条固定的是「为什么不能用 JSON.stringify 比较」：序列化在三个方向上给出错答案。
  it("对象的键序不影响判定：同内容、不同插入序不算改动", () => {
    expect(diffTouched({ nested: { x: 1, y: 2 } }, { nested: { y: 2, x: 1 } })).toStrictEqual([]);
  });

  it("NaN 与 null 不等价，NaN 与 NaN 等价（序列化会把两者都渲染成 null）", () => {
    expect(diffTouched({ temp: Number.NaN }, { temp: null })).toStrictEqual(["temp"]);
    expect(diffTouched({ temp: Number.NaN }, { temp: Number.NaN })).toStrictEqual([]);
    expect(diffTouched({ temp: Number.POSITIVE_INFINITY }, { temp: null })).toStrictEqual(["temp"]);
  });

  it("数组按逐项比较，长度或元素不同才进差异", () => {
    expect(diffTouched({ model: [1, 2] }, { model: [1, 2] })).toStrictEqual([]);
    expect(diffTouched({ model: [1, 2] }, { model: [2, 1] })).toStrictEqual(["model"]);
    expect(diffTouched({ model: [1, 2] }, { model: [1] })).toStrictEqual(["model"]);
  });

  it("bigint 与循环引用都不抛（序列化在这两种值上直接抛 TypeError / RangeError）", () => {
    expect(diffTouched({ count: 1n }, { count: 2n })).toStrictEqual(["count"]);
    const left: Record<string, unknown> = {};
    left["self"] = left;
    const right: Record<string, unknown> = {};
    right["self"] = right;
    expect(diffTouched({ cyclic: left }, { cyclic: right })).toStrictEqual([]);
  });

  it("对象的键集不同即算改动：少一个键、或同数量但换了键名", () => {
    expect(diffTouched({ nested: { x: 1, y: 2 } }, { nested: { x: 1 } })).toStrictEqual(["nested"]);
    expect(diffTouched({ nested: { x: 1, y: 2 } }, { nested: { x: 1, z: 2 } })).toStrictEqual([
      "nested",
    ]);
  });

  it("同一对对象出现在两个字段里时，各字段独立判定（不能共用一个已访问表）", () => {
    const pair: Record<string, unknown> = { level: 1 };
    const other: Record<string, unknown> = { level: 2 };
    expect(diffTouched({ alpha: pair, beta: pair }, { alpha: other, beta: other })).toStrictEqual([
      "alpha",
      "beta",
    ]);
  });

  it("单节点环对双节点环也终止：配对表记完整左右配对，而不是只记右节点", () => {
    const left: Record<string, unknown> = {};
    left["next"] = left;
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    first["next"] = second;
    second["next"] = first;
    expect(diffTouched({ cyclic: left }, { cyclic: first })).toStrictEqual([]);
    expect(diffTouched({ cyclic: first }, { cyclic: left })).toStrictEqual([]);
  });

  it("不同周期的环也终止：三节点环对两节点环", () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    const third: Record<string, unknown> = {};
    first["next"] = second;
    second["next"] = third;
    third["next"] = first;
    const otherFirst: Record<string, unknown> = {};
    const otherSecond: Record<string, unknown> = {};
    otherFirst["next"] = otherSecond;
    otherSecond["next"] = otherFirst;
    expect(diffTouched({ cyclic: first }, { cyclic: otherFirst })).toStrictEqual([]);
  });

  it("回边之后的不同字段仍会被报出", () => {
    const left: Record<string, unknown> = {};
    left["next"] = left;
    left["value"] = 1;
    const right: Record<string, unknown> = {};
    right["next"] = right;
    right["value"] = 2;
    expect(diffTouched({ cyclic: left }, { cyclic: right })).toStrictEqual(["cyclic"]);
  });

  it("稀疏数组按索引对称比较：空洞按 undefined，交换左右不改变结论", () => {
    const hole: unknown[] = [];
    hole.length = 1;
    expect(diffTouched({ x: hole }, { x: [42] })).toStrictEqual(["x"]);
    expect(diffTouched({ x: [42] }, { x: hole })).toStrictEqual(["x"]);
    expect(diffTouched({ x: hole }, { x: [undefined] })).toStrictEqual([]);
    expect(diffTouched({ x: [undefined] }, { x: hole })).toStrictEqual([]);
  });

  it("快照只认自有可枚举字段：原型链上的 toString 不是快照值", () => {
    expect(diffTouched({ toString: undefined }, {})).toStrictEqual([]);
    expect(diffTouched({ constructor: undefined }, {})).toStrictEqual([]);
    const inherited: Record<string, unknown> = {};
    Object.setPrototypeOf(inherited, { x: 1 });
    expect(diffTouched({ x: 1 }, inherited)).toStrictEqual(["x"]);
  });

  it("嵌套层同样把 undefined、null 与缺失视为同一值", () => {
    expect(diffTouched({ nested: { a: undefined } }, { nested: {} })).toStrictEqual([]);
    expect(diffTouched({ nested: {} }, { nested: { a: null } })).toStrictEqual([]);
    expect(diffTouched({ nested: { a: 1, extra: undefined } }, { nested: { a: 1 } })).toStrictEqual(
      [],
    );
    expect(diffTouched({ nested: { a: 1 } }, { nested: { a: 1, extra: 2 } })).toStrictEqual([
      "nested",
    ]);
  });

  it("对象键集统一按自有可枚举口径：非枚举属性两个方向都不算键", () => {
    const hybrid = Object.defineProperty({ y: 2 }, "x", { value: 1, enumerable: false });
    expect(diffTouched({ field: { x: 1 } }, { field: hybrid })).toStrictEqual(["field"]);
    expect(diffTouched({ field: hybrid }, { field: { x: 1 } })).toStrictEqual(["field"]);
    const hidden = Object.defineProperty({}, "x", { value: 1, enumerable: false });
    expect(diffTouched({ field: hidden }, { field: {} })).toStrictEqual([]);
    expect(diffTouched({ field: hidden }, { field: { x: 1 } })).toStrictEqual(["field"]);
    expect(diffTouched({ field: { x: 1 } }, { field: hidden })).toStrictEqual(["field"]);
  });

  it("值域外的对象只按引用比较：不同 Date/Map/Set 不静默判等", () => {
    expect(diffTouched({ at: new Date(2020, 1, 1) }, { at: new Date(2021, 1, 1) })).toStrictEqual([
      "at",
    ]);
    expect(
      diffTouched({ index: new Map([["a", 1]]) }, { index: new Map([["a", 2]]) }),
    ).toStrictEqual(["index"]);
    expect(diffTouched({ tags: new Set([1]) }, { tags: new Set([2]) })).toStrictEqual(["tags"]);
    const same = new Date(2020, 1, 1);
    expect(diffTouched({ at: same }, { at: same })).toStrictEqual([]);
  });

  it("共享子对象与内容相同的独立子对象仍判等", () => {
    const shared: Record<string, unknown> = { level: 1 };
    expect(
      diffTouched({ field: [shared, shared] }, { field: [{ level: 1 }, { level: 1 }] }),
    ).toStrictEqual([]);
    expect(
      diffTouched({ field: [{ level: 1 }, { level: 1 }] }, { field: [shared, shared] }),
    ).toStrictEqual([]);
  });

  it("极深嵌套不再受调用栈限制", () => {
    let left: Record<string, unknown> = {};
    let right: Record<string, unknown> = {};
    for (let depth = 0; depth < 3000; depth += 1) {
      left = { nested: left };
      right = { nested: right };
    }
    expect(diffTouched({ root: left }, { root: right })).toStrictEqual([]);
  });
});

describe("formValueEquals（公开入口）", () => {
  it("键序不影响判定；NaN 与 NaN 相等、与 null 不等", () => {
    expect(formValueEquals({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
    expect(formValueEquals(Number.NaN, Number.NaN)).toBe(true);
    expect(formValueEquals(Number.NaN, null)).toBe(false);
  });

  it("-0 与 0 不相等（这是与 JSON.stringify 相反的一条）", () => {
    expect(formValueEquals(-0, 0)).toBe(false);
    expect(formValueEquals(0, 0)).toBe(true);
  });

  it("bigint 与循环引用都不抛", () => {
    expect(formValueEquals(1n, 1n)).toBe(true);
    expect(formValueEquals(1n, 2n)).toBe(false);
    const left: Record<string, unknown> = {};
    const right: Record<string, unknown> = {};
    left["self"] = left;
    right["self"] = right;
    expect(formValueEquals(left, right)).toBe(true);
  });

  it("数组按长度与逐项比较", () => {
    expect(formValueEquals([1, 2], [1, 2])).toBe(true);
    expect(formValueEquals([1, 2], [2, 1])).toBe(false);
    expect(formValueEquals([1, 2], [1])).toBe(false);
  });
});
