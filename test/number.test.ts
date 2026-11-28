// test/number.test.ts —— 数值钳制与三段版本比较。
//
// 两条承重语义：NaN/Infinity 不能穿过 clamp（Math.min/max 会让 NaN 原样漏过去）；
// 版本逐段比数值，不是比字符串（0.10.0 与 0.9.0）。

import { describe, expect, it } from "vitest";
import { clampInt, versionAtLeast } from "../lib/number.ts";

describe("versionAtLeast", () => {
  const base = { major: 1, minor: 2, patch: 3 };

  it("major 不同时只看 major", () => {
    expect(versionAtLeast({ major: 2, minor: 0, patch: 0 }, base)).toBe(true);
    expect(versionAtLeast({ major: 0, minor: 99, patch: 99 }, base)).toBe(false);
  });

  it("major 相同时看 minor", () => {
    expect(versionAtLeast({ major: 1, minor: 3, patch: 0 }, base)).toBe(true);
    expect(versionAtLeast({ major: 1, minor: 1, patch: 99 }, base)).toBe(false);
  });

  it("major/minor 相同时看 patch，相等算满足", () => {
    expect(versionAtLeast({ major: 1, minor: 2, patch: 4 }, base)).toBe(true);
    expect(versionAtLeast(base, base)).toBe(true);
    expect(versionAtLeast({ major: 1, minor: 2, patch: 2 }, base)).toBe(false);
  });
});

describe("clampInt", () => {
  it("有限数先 trunc 再夹到闭区间", () => {
    expect(clampInt(4.9, 0, 10, 5)).toBe(4);
    expect(clampInt(-4.9, -3, 10, 5)).toBe(-3);
    expect(clampInt(99, 0, 10, 5)).toBe(10);
  });

  it("NaN 与两个方向的 Infinity 都落 fallback", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(clampInt(value, 0, 10, 7)).toBe(7);
    }
  });
});
