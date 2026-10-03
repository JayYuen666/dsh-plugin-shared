#!/usr/bin/env node
/// <reference types="node" />
// 构建 dist/config/*.js：把两份**配置 facet**（oxlint.base.ts / vitest.base.ts）打成 ESM。
// 为什么需要这一步：消费包的 `oxlint.config.ts` / `vitest.config.ts` 按子路径
// `@jayyuen66/dsh-plugin-shared/config/...` 取用它们，而发布件躺在 node_modules 里 ——
// Node 对 node_modules 下的 .ts 直接抛 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING（实测：
// 消费包 `pnpm lint` 就断在这）。lib 那 13 个切面早有 dist 产物，配置面是唯一漏掉的一块。
// 说明符保持不变（./config/oxlint、./config/vitest.base），只把发布态的指向从 .ts 换成 dist 产物，
// 与 lib 切面「开发态 .ts / 发布态 dist .js」同一套形态。
// external 判据与 build-host.mjs 同源（dependencies + peerDependencies 的包名段一律外部化），
// 再加 FACET_PEERS：配置面吃的是各消费包自己的工具链，本包不替它们决定版本。这些工具链不进
// peerDependencies 是有意的——npm 7+ 会去满足 optional peer，而 oxlint 的 peerOptional
// `vite-plus` 把 vitest 钉成 5.0.1，与 vitest 的 `>=5.0.2` 无交集，结果是消费方
// `npm install @jayyuen66/dsh-plugin-shared` 直接 ERESOLVE 失败。前置要求改由 README 表达。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import { canonicalizeRegionPaths } from "./lib/canonicalize-region-paths.ts";
import { createIsExternal } from "./build-shared.mjs";

const root = import.meta.dirname;
const outDir = path.join(root, "dist", "config");

/**
 * 配置面必须由消费方提供的工具链包名段。`packageNameOf` 把 `vitest/config` 折成 `vitest`，
 * 所以这里只列包名，不列子路径。这些不进 peerDependencies 是有意的：npm 7+ 会去满足 optional
 * peer，而 oxlint 的 peerOptional vite-plus 把 vitest 钉成 5.0.1，与 vitest 的 >=5.0.2 无交集。
 */
const FACET_PEERS = ["oxlint", "vitest", "eslint-plugin-sonarjs"];

// 机械件与外部化口径在 build-shared.mjs（此前这里与 build-host.mjs 各有一份逐字副本）；
// 本脚本特有的只有上面那三枚 FACET_PEERS，作为 extraNames 递进去。
const isExternal = await createIsExternal(root, FACET_PEERS);

/** 两份配置 facet（消费方按 ./config/oxlint 与 ./config/vitest.base 取）。 */
const configFacets = ["oxlint.base", "vitest.base"];

/**
 * 打出配置 facet，返回「落盘绝对路径 → 文件文本」。
 * @returns {Promise<Map<string, string>>}
 */
export async function buildConfig() {
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
    // 同样压缩：配置面是消费方构建期才加载的，但它整个 dist/ 都在 files 白名单里，
    // 是本包最大的单个产物（oxlint.base 未压缩 36,139 B）。压掉的是规则表的注释与缩进，
    // 对 oxlint 读取规则毫无影响——它读的是结构，不是排版。
    minify: true,
  });
  const chunks = output.filter((item) => item.type === "chunk");
  if (chunks.length === 0) {
    throw new Error("rolldown generate returned no chunk output");
  }
  return new Map(
    chunks.map((chunk) => [
      path.join(outDir, chunk.fileName),
      canonicalizeRegionPaths(chunk.code, root),
    ]),
  );
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const built = await buildConfig();
  const artifacts = [...built.entries()];
  await Promise.all(artifacts.map(([file, code]) => writeFile(file, code, "utf8")));
  console.info("config built:", artifacts.length, "files -> dist/config/");
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
