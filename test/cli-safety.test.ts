// test/cli-safety.test.ts —— 拼进 shell 命令的字符串转义。
//
// 两种方言的内嵌单引号写法不同（POSIX `'\''`、pwsh `''`），NUL 则在两种方言下都必须
// 由函数自己拒绝：上游校验器可能被绕过，转义函数不能把「读不回原文」当成调用方的事。

import { describe, expect, it } from "vitest";
import { shq } from "../lib/cli-safety.ts";

describe("shq", () => {
  it(String.raw`POSIX：单引号包裹，内嵌单引号用 '\'' 断开再拼`, () => {
    expect(shq("plain")).toBe("'plain'");
    expect(shq("a'b")).toBe(String.raw`'a'\''b'`);
  });

  it("win32：单引号包裹，内嵌单引号双写", () => {
    expect(shq("plain", "win32")).toBe("'plain'");
    expect(shq("a'b", "win32")).toBe("'a''b'");
  });

  it("含 NUL 的值在两种方言下都拒绝", () => {
    for (const platform of ["posix", "win32"] as const) {
      expect(() => shq("a\u0000b", platform)).toThrow(/NUL/u);
    }
  });
});
