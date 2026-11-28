// build-host 防回归：shared 的 dist 里，值导入的官方件必须是**外部化裸说明符**。
//
// 为什么值得一条测试：本包是发布件，消费方 `npm i` 之后位于 node_modules 里的是 dist/，
// **没有源码可用**——"本机运行走源码不走 dist"这句理由只对本地 workspace 成立。
// 少了 external 选项，rolldown 就把 `truncateWithoutSplittingSurrogatePair` 的函数体复制进
// shared 的 chunk：同一进程里官方截断实现有两份身份（宿主一份 + shared dist 一份），而本包
// 从此为官方实现的行为负责。两个坏方向都不报错、只在消费侧发作，故与兄弟包同批固定。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHost, facets, materialize } from "../build-host.mjs";
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
    // 本包不产 host.js：buildHost() 交回「待写入路径 → 正文」的清单（多入口 + code-split
    // chunk），检查两侧都转换成按路径排序的摘要清单再比（判断依据见 test/host-freshness.ts）。
    const { pkgName, pkgDir, onDisk, built } = await hostFreshnessEvidence(import.meta.url);
    assert.equal(
      onDisk,
      built,
      onDisk === built
        ? "fresh"
        : `[${pkgName}] dist 产物已过期：lib/*.ts（或其依赖）变更后未重建。请运行：cd ${pkgDir} && node build-host.mjs`,
    );
  });

  it("materialize 只清 host 拥有的旧产物：旧根入口、旧 chunk 删，client/config/types 留", async () => {
    // 这条用例固定清理的**归属边界**：按相对路径判定，而不是 basename。
    // 三种真实残留都要在这里变红过：旧根入口（dist/index.js）、与 build/ 同名的旧根文件、
    // 换哈希后留在 dist/build/ 的 chunk。
    const built = await buildHost();
    const dir = await mkdtemp(path.join(tmpdir(), "dsh-host-materialize-"));
    // 旧 chunk 的正文：两处种下同一个文件内容时只写一次字面量。
    const staleCode = "// stale\n";
    // 期望被清掉的相对路径（断言与循环共用一份，避免字符串散落）。
    const removed = [
      "ast-walk.js",
      "build/stale-OLDHASH.js",
      "build/sub/nested-old.js",
      "foreign-artifact.js",
      "index.d.ts",
      "index.js",
    ].toSorted();
    try {
      await mkdir(path.join(dir, "build", "sub"), { recursive: true });
      await mkdir(path.join(dir, "config"), { recursive: true });
      await mkdir(path.join(dir, "types"), { recursive: true });
      await writeFile(path.join(dir, "client.js"), "// client\n", "utf8");
      await writeFile(path.join(dir, "index.js"), "// old barrel\n", "utf8");
      await writeFile(path.join(dir, "index.d.ts"), "export type Old = 1;\n", "utf8");
      await writeFile(path.join(dir, "ast-walk.js"), "// old root copy\n", "utf8");
      await writeFile(path.join(dir, "foreign-artifact.js"), "// foreign\n", "utf8");
      await writeFile(path.join(dir, "build", "stale-OLDHASH.js"), staleCode, "utf8");
      await writeFile(path.join(dir, "build", "sub", "nested-old.js"), staleCode, "utf8");
      await writeFile(path.join(dir, "config", "keep-me.js"), "// config\n", "utf8");
      await writeFile(path.join(dir, "types", "keep.d.ts"), "export type T = 1;\n", "utf8");

      const { artifacts, pruned } = await materialize(built, dir);

      assert.equal(artifacts, built.size);
      assert.deepEqual(pruned, removed);
      for (const rel of removed) {
        assert.ok(!existsSync(path.join(dir, rel)), `${rel} 应被清掉`);
      }
      for (const rel of ["tool.js", "tool-map.json", "plugin.js", "build/ast-walk.js"]) {
        assert.ok(existsSync(path.join(dir, rel)), `${rel} 应被写出`);
      }
      for (const rel of ["client.js", "config/keep-me.js", "types/keep.d.ts"]) {
        assert.ok(existsSync(path.join(dir, rel)), `${rel} 不属于 host 编排，不能被删`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("产物：@deepseek-ai/dsh-output-retention 保持裸说明符（未内联）", async () => {
    const out = await chunkText();
    // 说明符匹配必须容得下 minify：压缩产物里是 from"..."（from 后无空格），写死
    // `from "..."` 会在开启压缩那天误报。同一个文件下面那条判断本来就用 /from\s+/u，
    // 这里按同一规则写成 \s*（星号：压缩后一个空格都不剩）。
    assert.ok(
      /from\s*["']@deepseek-ai\/dsh-output-retention["']/u.test(out),
      "官方截断件必须以裸说明符留在 dist 里（做法 A：值导入的官方件一律外部化）",
    );
    // 「没有被内联」由上面那条完整表达：一旦内联，这条 import 就不复存在。
    // 原先那条 /^function truncateWithoutSplittingSurrogatePair\(/mu 在压缩后恒不成立
    //（标识符被改名），是一条永远不会失败的空检查——换成对「同一份身份只有一条导入」的正面计数，
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
      "残留 .ts说明符会让 Node 载入 dist 时抛 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING",
    );
  });

  it("产物：F3 的两枚官方件只当类型用，不得留运行时说明符", async () => {
    const out = await chunkText();
    // lib/job-outcome 只 import type：注册表实例由宿主注入，本包连 dsh-jobs 都不该在
    // dependencies 里（它只在 devDependencies，供 tsc 解析声明）。哪天有人值导入，
    // dist 就会多出一条消费方解析不到的说明符——那是发布件才发作的问题。
    // 判断只看 `from "…"` 位置：源码注释会随产物一起留下，整串匹配会被注释误伤。
    assert.ok(
      !/from\s*["']@deepseek-ai\/dsh-jobs/u.test(out),
      "dsh-jobs 只能是类型面：产物里出现它的 from说明符即值导入",
    );
    assert.ok(
      !/from\s*["']@deepseek-ai\/dsh-shell/u.test(out),
      "dsh-shell 只能是类型面：产物里出现它的 from说明符即值导入",
    );
  });

  it("facets 与 lib/ 下的切面一一对应（barrel 类型的同源清单不许漂移）", async () => {
    // 新增模块只改 lib/ 与 barrel、漏掉 build-host.mjs 的 facets 时，`./internal/tool/<module>`
    // 的 dist/<module>.js 不会产出，而其余检查全部通过——index.test.ts 管 barrel↔lib、
    // publish-manifest 管 exports↔lib，只有这份清单两边都搭不上。
    const listed = await readdir(path.join(import.meta.dirname, "..", "lib"));
    const onDisk = listed
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.replace(/\.ts$/u, ""))
      .toSorted();
    // 不进 facets 的：barrel 自己、只走子路径的 builder 期文本后处理代码，与构建编排模块
    // （它们同样只走子路径、由各包 build-*.mjs 消费，产物落 dist/build/）。
    const expected = [
      ...facets,
      "canonicalize-region-paths",
      "build-artifacts",
      "build-host",
      "build-client",
      "build-types",
      "build-tool-imports",
      "decorator-lowering",
      "require-calls",
      "ast-walk",
      // 只走子路径，不进根 barrel：值导入 typert（见 build-host.mjs 的 entries 注释）。
      "remote-marker",
      // 单实例锁只给宿主侧 apply 用，同样只走子路径。
      "instance-lock",
      // 虚拟 skill 注册同样是宿主侧 apply 才用，根 barrel 没有通用消费方。
      "skill",
      // 占位符插值同样只走子路径：消费方是各包自己的 messages 表。
      "placeholder",
      // 三个新骨架模块同样不进根 barrel：typert-client 类型面引用 typert-protocol（不装
      // typert 的消费方不该被 barrel 逼着解析它）；session-projection 消费方只有两个；
      // with-timeout 客户端内联 / 宿主外置两种取法都走 ./tool 或 ./client。
      "typert-client",
      "session-projection",
      "with-timeout",
      // 客户端专用子模块：只经 ./client 导出，不进根 barrel（react 只属于卡片消费方）。
      "card-ui",
      "index",
      // 宿主入口与客户端行：前者只补 apply，后者由 build-client.mjs 单独打包。
      "plugin",
      "client-entry",
      // 工具侧单一入口：`./tool` 指向 dist/tool.js，不进根 barrel。
      "tool",
      // `./tool` 的浏览器条件实现：package.json 的 browser 条件取它。
      "tool-browser",
      // 码点截断的零依赖实现：被 text.ts / tool-browser.ts 内联，不单独作为子路径。
      "code-points",
    ].toSorted();
    assert.deepEqual(onDisk, expected);
  });
});
