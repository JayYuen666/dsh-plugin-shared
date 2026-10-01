// lib/jsonl 单元测试：JSONL 尾部对半收缩的**纯**决策件。
// 为什么单独测：SP-D 把两份逐字符同义的写盘实现（ctx-observe 的 metrics 分片、lesson-loop 的
// lessons 落库）收敛成这一份决策，而两家的**触发策略与错误出口刻意不同、不能统一**
// （lesson-loop 出厂 maxBytes=0 = 永不截断，那是写进它 README 的承诺）。
// ⇒ 这里只钉"该留什么"，磁盘与异常归各包；期望值由实测算出而非手推。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { shrinkJsonlTail } from "../lib/jsonl.ts";

/** count 行、每行 `"k".repeat(width) + 序号`，末行无换行。 */
function rows(count: number, width = 30): string {
  return Array.from({ length: count }, (_row, index) => `${"k".repeat(width)}${index}`).join("\n");
}

describe("shrinkJsonlTail（按字节上限对半保留尾部行段）", () => {
  it("未超限 → 返回入参**同一引用**（调用方据此跳过写盘）", () => {
    const text = "ab\ncd\n";
    assert.equal(shrinkJsonlTail(text, 4096), text);
    assert.equal(shrinkJsonlTail("", 0), "");
  });

  it("对半收缩到 ≤maxBytes 且不切断行（形状搬自 ctx-observe/test/host.test.ts:1728-1748）", () => {
    const shrunk = shrinkJsonlTail(`${rows(400)}\n`, 1024);
    // 401 段经 201→101→51→26 四次对半收敛，末次起点是序号 375；850 字节 ≤ 1024。
    assert.equal(shrunk.split("\n").length, 26);
    assert.equal(Buffer.byteLength(shrunk, "utf8"), 850);
    assert.equal(shrunk.startsWith(`${"k".repeat(30)}375`), true);
  });

  it("单行超限 → 原样返回，防死循环也防清空（搬自 ctx-observe/test/host.test.ts:1750-1757）", () => {
    const text = `${"x".repeat(4096)}\n`;
    assert.equal(shrinkJsonlTail(text, 1024), text, "两行（含尾换行产生的空段）即止手");
  });

  it("keep 以换行开头 → 去掉前导换行，不产生空首行", () => {
    assert.equal(shrinkJsonlTail("a\n\nb", 2), "b");
    assert.equal(shrinkJsonlTail("aaaa\nbbbb\n\ncccc\n", 3), "cccc\n");
  });

  it("判据是 UTF-8 字节数而不是字符数", () => {
    const text = `${"汉".repeat(50)}\nsecond\nthird`;
    assert.equal(text.length, 63);
    assert.equal(Buffer.byteLength(text, "utf8"), 163);
    assert.equal(shrinkJsonlTail(text, 40), "second\nthird");
  });
});
