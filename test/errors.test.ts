// lib/errors 单元测试：把 unknown 错误归一成界面文本。
// 为什么单独测：SP-D 从 4 个包里回删出这一份真源，而**两家既有断言是逐字搬进来的**
// （zvec-grep/test/routing.test.ts 的跨 realm 案与 dir-prep-organize/test/client.test.ts 的
// 形状案），搬完即删原文件那份 ⇒ 这里少一条，就等于全仓少一条断言。
import vm from "node:vm";
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { errorText } from "../lib/errors.ts";

describe("errorText（unknown 错误的界面文本归一）", () => {
  it("本域 Error 取 message；跨 realm 的 Error 退化为 String()（搬自 zvec-grep/test/routing.test.ts:35-45）", () => {
    assert.equal(
      errorText(new Error("root 必填，且为工作区绝对路径")),
      "root 必填，且为工作区绝对路径",
    );
    // vm 里造的 Error 在本域 `instanceof Error === false`：只能走 String() 兜底
    const alien: unknown = vm.runInNewContext("new Error('alien boom')");
    assert.equal(alien instanceof Error, false, "前提：确为跨 realm 对象");
    assert.equal(errorText(alien), "Error: alien boom");
    assert.equal(errorText("plain rejection"), "plain rejection");
  });

  it("非 Error 值原样转字符串（搬自 dir-prep-organize/test/client.test.ts:759-763）", () => {
    assert.equal(errorText(new Error("写入被拒")), "写入被拒");
    assert.equal(errorText("字符串 reject"), "字符串 reject");
    assert.equal(errorText(409), "409");
    assert.equal(errorText(null), "null");
  });
});
