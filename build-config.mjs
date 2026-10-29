#!/usr/bin/env node
/// <reference types="node" />
// 构建 dist/config/*.js：把两份**配置模块**（oxlint.base.ts / vitest.base.ts）打成 ESM。
// 为什么需要这一步：消费包的 `oxlint.config.ts` / `vitest.config.ts` 按子路径
// `@jayyuen66/dsh-plugin-shared/config/...` 取用它们，而发布件位于 node_modules 里 ——
// Node 对 node_modules 下的 .ts 直接抛 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING（实测：
// 消费包 `pnpm lint` 就断在这里）。lib 那批模块早有 dist 产物，配置产物是唯一漏掉的一块。
// 说明符保持不变（./config/oxlint、./config/vitest.base），只把发布态的指向从 .ts 换成 dist 产物，
// 与 lib 模块「开发态 .ts / 发布态 dist .js」同一套形态。
// external 判定与 build-host.mjs 同源（dependencies + peerDependencies 的包名段一律外部化），
// 再加 FACET_PEERS：配置代码用的是各消费包自己的工具链，本包不替它们决定版本。这些工具链不进
// peerDependencies 是有意的——npm 7+ 会去满足 optional peer，而 oxlint 的 peerOptional
// `vite-plus` 把 vitest 锁在 5.0.1，与 vitest 的 `>=5.0.2` 无交集，结果是消费方
// `npm install @jayyuen66/dsh-plugin-shared` 直接 ERESOLVE 失败。前置要求改由 README 表达。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import { canonicalizeRegionPaths } from "./lib/canonicalize-region-paths.ts";
import { createIsExternal, isMainModule } from "./build-shared.mjs";

const root = import.meta.dirname;
const outDir = path.join(root, "dist", "config");

/**
 * 配置代码必须由消费方提供的工具链包名段。`packageNameOf` 把 `vitest/config` 归结为 `vitest`，
 * 所以这里只列包名，不列子路径。这些不进 peerDependencies 是有意的：npm 7+ 会去满足 optional
 * peer，而 oxlint 的 peerOptional vite-plus 把 vitest 锁在 5.0.1，与 vitest 的 >=5.0.2 无交集。
 */
const FACET_PEERS = [
  "oxlint",
  "vitest",
  "eslint-plugin-sonarjs",
  "eslint-plugin-regexp",
  "eslint-plugin-zod",
  "@e18e/eslint-plugin",
];

// 机械代码与外部化规则在 build-shared.mjs（此前这里与 build-host.mjs 各有一份逐字副本）；
// 本脚本特有的只有上面那张 FACET_PEERS，作为 extraNames 传进去。
const isExternal = await createIsExternal(root, FACET_PEERS);

/** 两份配置模块（消费方按 ./config/oxlint 与 ./config/vitest.base 取）。 */
const configFacets = ["oxlint.base", "vitest.base"];

/**
 * 打出配置模块，返回「落盘绝对路径 → 文件文本」。
 * @returns {Promise<Map<string, string>>}
 */
export async function buildConfig() {
  // mkdir 放在导出函数内而不是 main()：buildConfig 是导出面，被测试或别的脚本直接调用时
  // 目录不存在会让 writeFile 报 ENOENT，而「产物落在哪」是这个函数自己的约定。
  await mkdir(outDir, { recursive: true });
  const bundle = await rolldown({
    input: configFacets.map((facet) => path.join(root, "config", `${facet}.ts`)),
    platform: "node",
    external: isExternal,
    resolve: { extensions: [".ts", ".mjs", ".js"] },
  });
  const { output } = await bundle.generate({
    format: "esm",
    entryFileNames: "[name].js",
    chunkFileNames: "[name]-[hash].js",
    // 同样压缩：配置产物是消费方构建期才加载的，但它整个 dist/ 都在 files 白名单里，
    // 是本包最大的单个产物（oxlint.base 未压缩时远大于其余各件）。压掉的是规则表的注释与缩进，
    // 对 oxlint 读取规则毫无影响——它读的是结构，不是排版。
    minify: true,
  });
  // 与 build-host.mjs 相同：bundle 持有 worker 与句柄，用完显式关掉。
  await bundle.close();
  const chunks = output.filter((item) => item.type === "chunk");
  if (chunks.length === 0) {
    throw new Error("rolldown generate returned no chunk output");
  }
  // 逐个模块校验入口 chunk 都在：只判 `chunks.length === 0` 时，两个入口里少一个也会照常
  // 「构建成功」，而消费方按 ./config/oxlint 或 ./config/vitest.base 取用时才拿到
  // ERR_MODULE_NOT_FOUND——一条构建期的可判事实被推迟到消费方的运行期。
  for (const facet of configFacets) {
    const present = chunks.some((chunk) => path.basename(chunk.fileName) === `${facet}.js`);
    if (!present) {
      throw new Error(`rolldown 没为 facet ${facet} 产出入口 chunk`);
    }
  }
  return new Map(
    chunks.map((chunk) => [
      path.join(outDir, chunk.fileName),
      canonicalizeRegionPaths(chunk.code, root, process.cwd()),
    ]),
  );
}

async function main() {
  const built = await buildConfig();
  const artifacts = [...built.entries()];
  await Promise.all(artifacts.map(([file, code]) => writeFile(file, code, "utf8")));
  console.info("config built:", artifacts.length, "files -> dist/config/");
}

if (isMainModule(import.meta.filename)) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
