// test/card-diff.test.ts —— touched 层与快照的差异投影。
//
// 钉的是"值语义"这一条：引用相等会把等值数组判成没改、把重排的同内容数组判成改了，
// 两种都会让用户看到不该出现的"有改动"提示或丢掉该出现的。

import { describe, expect, it } from "vitest";
import { diffTouched } from "../lib/card-diff.ts";

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

  // 下面几条钉的是「为什么不能用 JSON.stringify 比较」：序列化在三个方向上给出错答案。
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
});
