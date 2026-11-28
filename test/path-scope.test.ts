// test/path-scope.test.ts —— 「某个绝对路径是否在根之下」的唯一判据。
//
// 关键回归是 `..cache`：`relative()` 交回 `..cache`，只看 `startsWith("..")` 会把它判成
// 「跑到根外」——方向是放行。四种边界（等值、普通后代、`..` 上跳、跨盘符绝对 rel）各钉一次。

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAbsoluteRoot,
  isAncestorDirOf,
  isPathInside,
  normalizeAbsolutePath,
} from "../lib/path-scope.ts";

/** 同一目录的两种拼写：`relative` 对它们给空串，用来钉「自身不算祖先」与「包含含等值」。 */
const APP_PLAIN = "/work/app";
const APP_TRAILING = "/work/app/";

describe("isPathInside（POSIX）", () => {
  it("自身与后代为 true，名为 ..cache 的后代也是 true", () => {
    expect(isPathInside("/work", "/work", path.posix)).toBe(true);
    expect(isPathInside("/work", "/work/src", path.posix)).toBe(true);
    expect(isPathInside("/work", "/work/..cache", path.posix)).toBe(true);
  });

  it("`..` 与 `../` 上跳为 false，绝对 rel 也为 false", () => {
    expect(isPathInside("/work", "/work/..", path.posix)).toBe(false);
    expect(isPathInside("/work", "/work/../etc", path.posix)).toBe(false);
    expect(isPathInside("/work", "/etc", path.posix)).toBe(false);
  });

  it("同一路径的空 rel 与外部路径的绝对 rel 分开覆盖", () => {
    // `relative("/work", "/work")` 是空串；跨根时 `relative` 仍会给出 `../etc`。
    expect(isPathInside("/work", "/work", path.posix)).toBe(true);
    expect(isPathInside("/work", "/other", path.posix)).toBe(false);
  });

  it("同一路径的不同拼写（尾分隔符/点段）仍是包含", () => {
    expect(isPathInside(APP_PLAIN, APP_TRAILING, path.posix)).toBe(true);
    expect(isPathInside(APP_TRAILING, APP_PLAIN, path.posix)).toBe(true);
    expect(isPathInside(APP_PLAIN, `${APP_PLAIN}/.`, path.posix)).toBe(true);
  });

  it("相似前缀的兄弟目录不算包含", () => {
    expect(isPathInside("/work", "/workspace", path.posix)).toBe(false);
    expect(isPathInside("/work", "/work-old/src", path.posix)).toBe(false);
  });
});

describe("isPathInside（Windows）", () => {
  it("分隔符与 `..cache` 按 win32 语义判断", () => {
    expect(isPathInside(String.raw`C:\repo`, String.raw`C:\repo\..cache`, path.win32)).toBe(true);
    expect(isPathInside(String.raw`C:\repo`, String.raw`C:\repo\src`, path.win32)).toBe(true);
    expect(isPathInside(String.raw`C:\repo`, String.raw`C:\repo\..\etc`, path.win32)).toBe(false);
  });

  it("跨盘符时 relative 交回绝对路径，必须判 false", () => {
    expect(isPathInside(String.raw`C:\repo`, String.raw`D:\repo`, path.win32)).toBe(false);
  });

  it("仅大小写不同的同一路径仍是包含（NTFS 默认不区分大小写）", () => {
    expect(isPathInside(String.raw`C:\Repo`, String.raw`C:\repo`, path.win32)).toBe(true);
  });

  it("跨 UNC 共享不算包含", () => {
    expect(isPathInside(String.raw`\\srv\share`, String.raw`\\srv\other\x`, path.win32)).toBe(
      false,
    );
  });
});

describe("isAncestorDirOf", () => {
  it("严格祖先为 true，自身与后代为 false", () => {
    expect(isAncestorDirOf("/work", "/work/src", path.posix)).toBe(true);
    expect(isAncestorDirOf("/work", "/work", path.posix)).toBe(false);
    expect(isAncestorDirOf("/work/src", "/work", path.posix)).toBe(false);
    expect(isAncestorDirOf("/work", "/work/..cache", path.posix)).toBe(true);
  });

  it("同一路径的不同拼写不算祖先（不能靠字符串不等排除自身）", () => {
    expect(isAncestorDirOf(APP_PLAIN, APP_TRAILING, path.posix)).toBe(false);
    expect(isAncestorDirOf(APP_TRAILING, APP_PLAIN, path.posix)).toBe(false);
    expect(isAncestorDirOf(String.raw`C:\Repo`, String.raw`C:\repo`, path.win32)).toBe(false);
  });
});

const PATH_MESSAGES = {
  mustBeAbsolute: (input: string): string => `not-absolute:${input}`,
  escapesRoot: (input: string): string => `escapes:${input}`,
};

const ROOT_MESSAGES = {
  ...PATH_MESSAGES,
  typeError: (received: string): string => `type:${received}`,
  required: "required",
  nul: "nul",
  filesystemRoot: (input: string): string => `root:${input}`,
};

describe("normalizeAbsolutePath（词法归一 + 越根拒绝）", () => {
  it("POSIX：去空段与点段、解析 ..，根自身保留", () => {
    expect(normalizeAbsolutePath("/repo//sub/./", "posix", PATH_MESSAGES)).toBe("/repo/sub");
    expect(normalizeAbsolutePath("/repo/../other", "posix", PATH_MESSAGES)).toBe("/other");
    expect(normalizeAbsolutePath("/", "posix", PATH_MESSAGES)).toBe("/");
  });

  it("POSIX：段序列按根下处理；.. 越过根拒绝", () => {
    expect(normalizeAbsolutePath("repo/src", "posix", PATH_MESSAGES)).toBe("/repo/src");
    expect(() => normalizeAbsolutePath("/../../etc", "posix", PATH_MESSAGES)).toThrow(/escapes/u);
  });

  it("win32：盘符/UNC 保留根、统一分隔符、剥扩展前缀", () => {
    expect(normalizeAbsolutePath(String.raw`C:\repo\src`, "win32", PATH_MESSAGES)).toBe(
      String.raw`C:\repo\src`,
    );
    expect(normalizeAbsolutePath("C:/repo//sub/", "win32", PATH_MESSAGES)).toBe(
      String.raw`C:\repo\sub`,
    );
    expect(normalizeAbsolutePath(String.raw`\\?\C:\repo`, "win32", PATH_MESSAGES)).toBe(
      String.raw`C:\repo`,
    );
    expect(normalizeAbsolutePath(String.raw`\\.\C:\repo`, "win32", PATH_MESSAGES)).toBe(
      String.raw`C:\repo`,
    );
    expect(normalizeAbsolutePath(String.raw`\\?\UNC\srv\share\x`, "win32", PATH_MESSAGES)).toBe(
      String.raw`\\srv\share\x`,
    );
    expect(normalizeAbsolutePath(String.raw`\\srv\share\x`, "win32", PATH_MESSAGES)).toBe(
      String.raw`\\srv\share\x`,
    );
  });

  it("win32：盘符相对与当前盘根相对不是完整路径，.. 越根也拒绝", () => {
    for (const bad of ["C:repo", String.raw`\repo`]) {
      expect(() => normalizeAbsolutePath(bad, "win32", PATH_MESSAGES)).toThrow(/not-absolute/u);
    }
    expect(() => normalizeAbsolutePath(String.raw`C:\..\x`, "win32", PATH_MESSAGES)).toThrow(
      /escapes/u,
    );
  });

  it("win32：扩展前缀在统一分隔符之后再剥，拼写变体落同一个规范形", () => {
    // 先剥再统一分隔符时，`//?/C:/repo` 会剥不到前缀、随后变成 `\\?\C:\repo`，
    // 同一个目录于是留下两种规范形。
    expect(normalizeAbsolutePath("//?/C:/repo", "win32", PATH_MESSAGES)).toBe(String.raw`C:\repo`);
    expect(normalizeAbsolutePath(String.raw`\\?\unc\srv\share\x`, "win32", PATH_MESSAGES)).toBe(
      String.raw`\\srv\share\x`,
    );
  });

  it("win32：NT 命名空间与设备路径不是受支持的普通绝对路径", () => {
    // `\\??\` 是 `\\?\` 的对象管理器写法，`\\.\pipe\…` 与卷 GUID 都不指向普通目录；
    // `parse().root` 能把它们拆出「根」，但那不等于那个根可用。
    for (const bad of [
      String.raw`\\??\C:\repo`,
      String.raw`\\.\pipe\x`,
      String.raw`\\?\Volume{1}\x`,
    ]) {
      expect(() => normalizeAbsolutePath(bad, "win32", PATH_MESSAGES)).toThrow(/not-absolute/u);
    }
  });
});

describe("assertAbsoluteRoot（类型/必填/NUL/绝对/根）", () => {
  it("POSIX：规范化后交出，根与越根都拒绝", () => {
    expect(assertAbsoluteRoot("  /repo//sub/  ", "posix", ROOT_MESSAGES)).toBe("/repo/sub");
    expect(assertAbsoluteRoot("/repo/../other", "posix", ROOT_MESSAGES)).toBe("/other");
    for (const bad of ["/", "//", "/repo/.."]) {
      expect(() => assertAbsoluteRoot(bad, "posix", ROOT_MESSAGES)).toThrow(/root:/u);
    }
    expect(() => assertAbsoluteRoot("/a/../../b", "posix", ROOT_MESSAGES)).toThrow(/escapes/u);
  });

  it("win32：盘符根与 UNC 共享根拒绝，普通盘符/UNC 目录收下", () => {
    expect(assertAbsoluteRoot(String.raw`C:\repo\src`, "win32", ROOT_MESSAGES)).toBe(
      String.raw`C:\repo\src`,
    );
    expect(assertAbsoluteRoot(String.raw`\\srv\share\dir`, "win32", ROOT_MESSAGES)).toBe(
      String.raw`\\srv\share\dir`,
    );
    for (const bad of ["C:\\", String.raw`\\srv\share`]) {
      expect(() => assertAbsoluteRoot(bad, "win32", ROOT_MESSAGES)).toThrow(/root:/u);
    }
    expect(() => assertAbsoluteRoot(String.raw`C:\repo\..\..\x`, "win32", ROOT_MESSAGES)).toThrow(
      /escapes/u,
    );
  });

  it("win32：扩展前缀的拼写变体归一到同一个根，命名空间形态拒绝", () => {
    expect(assertAbsoluteRoot("//?/C:/repo", "win32", ROOT_MESSAGES)).toBe(String.raw`C:\repo`);
    expect(() => assertAbsoluteRoot(String.raw`\\??\C:\repo`, "win32", ROOT_MESSAGES)).toThrow(
      /not-absolute/u,
    );
  });

  it("非字符串、空白、NUL、非绝对路径各走自己的文案", () => {
    expect(() => assertAbsoluteRoot(null, "posix", ROOT_MESSAGES)).toThrow(/type:null/u);
    expect(() => assertAbsoluteRoot(42, "win32", ROOT_MESSAGES)).toThrow(/type:number/u);
    expect(() => assertAbsoluteRoot("   ", "posix", ROOT_MESSAGES)).toThrow(/^required$/u);
    expect(() => assertAbsoluteRoot("/a\u0000b", "win32", ROOT_MESSAGES)).toThrow(/^nul$/u);
    expect(() => assertAbsoluteRoot("repo", "posix", ROOT_MESSAGES)).toThrow(/not-absolute/u);
  });
});
