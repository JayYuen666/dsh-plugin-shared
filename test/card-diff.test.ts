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
});
