// test/dist-size.test.ts —— 产物体积闸门。
//
// 为什么要有：`npm run check` 的顺序是 build 在 test 之前，所以这道门读到的是**当轮刚产出**的
// dist，不是上一次遗留的。它挡的是两类回退：
//   1. 有人关掉 build-host.mjs / build-config.mjs 的 minify —— 运行期会从 10 KB 弹回 35 KB；
//   2. 有人在某个切面里塞进大对象字面量或整段查表。
// 两类都不会让任何现有用例变红（体积不是行为），所以必须有一道单独的尺子。
//
// 预算怎么定的：取当前实测值上浮约 25%。留这 25% 是给正常演进的——加一个导出、改一条错误文案
// 不该立刻要人改预算；但翻倍一定会顶穿。��。真需要突破时，改这两个常量并写明理由。
//
// 明确不设的闸门：barrel 单独一条线。压缩后它反而变大（1,300 -> 1,523 B），因为打包器把
// re-export 的具名清单展开了；单看它会得出「压缩有害」的错误结论，所以按总量算。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const pkgDir = path.resolve(import.meta.dirname, "..");

/** 运行期切面预算（实测 10,345 B）。消费方按子路径 external 取用，这些字节是真实装载成本。 */
const RUNTIME_BUDGET_BYTES = 13_000;
/** 配置面预算（实测 23,545 B）。构建期才加载，但整个 dist 都在 files 白名单里，一并计入 tarball。 */
const CONFIG_BUDGET_BYTES = 30_000;

/**
 * 某目录下所有 .js 的字节合计（**不递归**）。
 *
 * 不递归是刻意的：dist/ 一层就是运行期切面，dist/config 是配置面，两者本来就分开记账。
 * 这里曾经写成「dist 总量 - dist/config 总量」，而 dist/ 一层本来就不含 config，于是相减
 * 得到负数、断言恒真——一条永远绿的闸门比没有闸门更坏，它让人以为有护栏。
 * @param relDir - 相对包根的目录
 * @returns 字节合计
 */
function jsBytesUnder(relDir: string): number {
  const dir = path.join(pkgDir, relDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .reduce((sum, name) => sum + readFileSync(path.join(dir, name)).byteLength, 0);
}

describe("dist 体积闸门", () => {
  it("运行期切面总量在预算内", () => {
    const bytes = jsBytesUnder("dist");
    assert.ok(
      bytes <= RUNTIME_BUDGET_BYTES,
      `运行期切面 ${bytes} B 超预算 ${RUNTIME_BUDGET_BYTES} B。若是关掉了 minify 请改回；` +
        "若确实需要变大，请改 test/dist-size.test.ts 的常量并写明理由。",
    );
  });

  it("配置面总量在预算内", () => {
    const bytes = jsBytesUnder("dist/config");
    assert.ok(bytes <= CONFIG_BUDGET_BYTES, `配置面 ${bytes} B 超预算 ${CONFIG_BUDGET_BYTES} B。`);
  });
});
