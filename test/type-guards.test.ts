// test/type-guards.test.ts —— 编译期护栏：这些断言由 tsc 判定，不由 vitest 判定。
//
// 为什么需要独立一个文件：config/vitest.base.ts 的四项 100% 覆盖率只看得到「某行跑过没有」，
// 看不到「某个非法调用编不过」。lib/locale.ts 的值域洞就是这样活下来的——它零错误通过，
// 覆盖率却是满的。@ts-expect-error 是 TS 自带的负向断言：约束还在时它压住一条真错误；
// 约束一旦被撤掉，那行不再报错，tsc 立刻报 unused directive，本文件转红。
//
// 每条负向断言都配一条正向断言：正向负责「别把合法的也挡了」，负向负责「非法的还在挡」。
// 只写负向的话，一个把 Messages 约束成 never 的过改也会让它全绿。

import { describe, expect, it } from "vitest";
import { messagesFor } from "../lib/locale.ts";
import type { MessagesCatalog } from "../lib/locale.ts";

// 消费方的标准写法：interface + readonly。映射类型约束必须对它成立——
// extends Record<string, string> 会在这里炸（interface 拿不到隐式索引签名）。
interface Messages {
  readonly greeting: string;
}

const catalog: MessagesCatalog<Messages> = {
  zh: { greeting: "你好" },
  en: { greeting: "hello" },
};

describe("messagesFor 的值域护栏", () => {
  it("interface 声明的 Messages 仍可正常取用（正向：别把合法的挡了）", () => {
    expect(messagesFor(catalog, "zh").greeting).toBe("你好");
    expect(messagesFor(catalog, "en").greeting).toBe("hello");
  });
});

// 负向断言：下面每一行都必须编不过，否则本文件失去意义。
//
// 写法约束：@ts-expect-error 只压制**紧邻的下一行**，所以这两条表达式必须各自单行、
// 且短到 oxfmt 不会把它折开——折开一次，指令就落到没有错误的那一行，于是变成 TS2578。

// @ts-expect-error 值域钉在 string 上：zh 那一支的值是 number，必须被拒。
export const rejectsNonStringValue = messagesFor({ zh: { a: 1 }, en: { a: "x" } }, "zh");

// @ts-expect-error 键集绑 Locale：少一门语言必须被拒（防止有人改回二元分派）。
export const rejectsMissingLocale = messagesFor({ zh: { a: "你好" } }, "en");
