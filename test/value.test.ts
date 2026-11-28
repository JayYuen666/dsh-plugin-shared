// test/value.test.ts —— unknown → 文本/正则片段的零依赖转换。
//
// 两个名字的差别是**契约**：asText 只认字符串，asDisplayText 接受 number/boolean。
// 合成一个函数会让「只认字符串」的调用点静默收下类型错，或让展示层丢掉合法读数。

import { describe, expect, it } from "vitest";
import { asDisplayText, asText, escapeRegExp } from "../lib/value.ts";

describe("asText", () => {
  it("只认字符串；其余原始值给空串", () => {
    expect(asText("model")).toBe("model");
    expect(asText(42)).toBe("");
    expect(asText(true)).toBe("");
    expect(asText(null)).toBe("");
    expect(asText({ text: "model" })).toBe("");
  });
});

describe("asDisplayText", () => {
  it("字符串原样，number/boolean 走 String()", () => {
    expect(asDisplayText("model")).toBe("model");
    expect(asDisplayText(42)).toBe("42");
    expect(asDisplayText(false)).toBe("false");
  });

  it("对象、null、undefined、bigint 一律空串，不产生 [object Object]", () => {
    expect(asDisplayText({})).toBe("");
    expect(asDisplayText(null)).toBe("");
    expect(asDisplayText(1n)).toBe("");
  });
});

describe("escapeRegExp", () => {
  it("转义正则元字符，普通文本原样", () => {
    expect(escapeRegExp(String.raw`a+b*c?d^e$f(g)h[i]j{k}l|m\n`)).toBe(
      String.raw`a\+b\*c\?d\^e\$f\(g\)h\[i\]j\{k\}l\|m\\n`,
    );
    expect(escapeRegExp("plain-text_2026")).toBe("plain-text_2026");
  });

  it("转义后的片段能按字面量匹配原文", () => {
    const literal = "a+b(c)[d]";
    expect(new RegExp(escapeRegExp(literal), "u").test(literal)).toBe(true);
  });
});
