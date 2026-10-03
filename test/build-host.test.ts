// build-host 防回归：shared 的 dist 里，值导入的官方件必须是**外部化裸说明符**。
//
// 为什么值得一条测试：本包是发布件，消费方 `npm i` 之后躺在 node_modules 里的是 dist/，
// **没有源码可走**——"本机运行面走源码不走 dist"这句理由只对本地 workspace 成立。
// 少了 external 选项，rolldown 就把 `truncateWithoutSplittingSurrogatePair` 的函数体复制进
// shared 的 chunk：同一进程里官方截断件有两份身份（宿主一份 + shared dist 一份），而本包
// 从此为官方实现的行为负责。两个坏方向都不报错、只在消费侧发作，故与兄弟包同批钉住。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildHost } from "../build-host.mjs";
import { hostFreshnessEvidence } from "./host-freshness.ts";

/** 把所有 chunk 的代码并成一段文本好做说明符判定。 */
async function chunkText(): Promise<string> {
  const files = await buildHost();
  return [...files.entries()]
    .filter(([file]) => file.endsWith(".js"))
    .map(([, code]) => code)
    .join("\n");
}

describe("shared buildHost()", () => {
  it("dist 全部产物与最新构建逐字节一致（改 lib/*.ts 后必须 node build-host.mjs）", async () => {
    // 本包不产 host.js：buildHost() 交回「落盘路径 → 正文」的清单（多入口 + code-split
    // chunk），门禁两侧都折成按路径排序的摘要清单再比（判据见 test/host-freshness.ts）。
    const { pkgName, pkgDir, onDisk, built } = await hostFreshnessEvidence(import.meta.url);
    assert.equal(
      onDisk,
      built,
      onDisk === built
        ? "fresh"
        : `[${pkgName}] dist 产物已过期：lib/*.ts（或其依赖）变更后未重建。请运行：cd ${pkgDir} && node build-host.mjs`,
    );
  });

  it("产物：@deepseek-ai/dsh-output-retention 保持裸说明符（未内联）", async () => {
    const out = await chunkText();
    // 说明符匹配必须容得下 minify：压缩产物里是 from"..."（from 后无空格），写死
    // `from "..."` 会在开压缩那天假报红。同一个文件下面那条判据本来就用 /from\s+/u，
    // 这里按同口径写成 \s*（星号：压缩后一个空格都不剩）。
    assert.ok(
      /from\s*["']@deepseek-ai\/dsh-output-retention["']/u.test(out),
      "官方截断件必须以裸说明符留在 dist 里（口径 A：值导入的官方件一律外部化）",
    );
    // 「没有被内联」由上面那条完整表达：一旦内联，这条 import 就不复存在。
    // 原先那条 /^function truncateWithoutSplittingSurrogatePair\(/mu 在压缩后恒不成立
    //（标识符被改名），是一条永远不会红的空判据——换成对「同一份身份只有一条导入」的正面计数，
    // 也就是本用例开头要防的那件事。
    assert.equal(
      [...out.matchAll(/from\s*["']@deepseek-ai\/dsh-output-retention["']/gu)].length,
      1,
      "官方截断件在 dist 里只应有一条导入（text 切面）；出现多条说明符意味着实现被复制",
    );
  });

  it("产物：不残留 ./x.ts 形态的相对说明符", async () => {
    const out = await chunkText();
    assert.ok(
      !/from\s+["'][^"']*\.ts["']/u.test(out),
      "残留 .ts 说明符会让 Node 载入 dist 时抛 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
    );
  });

  it("产物：F3 的两枚官方件只作类型面，不得留运行时说明符", async () => {
    const out = await chunkText();
    // lib/job-outcome 只 import type：注册表实例由宿主注入，本包连 dsh-jobs 都不该在
    // dependencies 里（它只在 devDependencies，供 tsc 解析声明）。哪天有人值导入，
    // dist 就会多出一条消费方解析不到的说明符——那是发布件才发作的坑。
    // 判据只看 `from "…"` 位置：源码注释会随产物一起留下，整串匹配会被注释误伤。
    assert.ok(
      !/from\s*["']@deepseek-ai\/dsh-jobs/u.test(out),
      "dsh-jobs 只能是类型面：产物里出现它的 from 说明符即值导入",
    );
    assert.ok(
      !/from\s*["']@deepseek-ai\/dsh-shell/u.test(out),
      "dsh-shell 只能是类型面：产物里出现它的 from 说明符即值导入",
    );
  });
});
