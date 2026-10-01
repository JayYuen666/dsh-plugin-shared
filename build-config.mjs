#!/usr/bin/env node
/// <reference types="node" />
// 构建 dist/config/*.js：把两份**配置 facet**（oxlint.base.ts / vitest.base.ts）打成 ESM。
// 为什么需要这一步：消费包的 `oxlint.config.ts` / `vitest.config.ts` 按子路径
// `@jayyuen66/dsh-plugin-shared/config/...` 取用它们，而发布件躺在 node_modules 里 ——
// Node 对 node_modules 下的 .ts 直接抛 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING（实测：
// 消费包 `pnpm lint` 就断在这）。lib 那 13 个切面早有 dist 产物，配置面是唯一漏掉的一块。
// 说明符保持不变（./config/oxlint、./config/vitest.base），只把发布态的指向从 .ts 换成 dist 产物，
// 与 lib 切面「开发态 .ts / 发布态 dist .js」同一套形态。
// external 判据与 build-host.mjs 同源：dependencies + peerDependencies 的包名段一律外部化，
// 所以 oxlint / vitest / eslint-plugin-sonarjs 必须是 peer（见 package.json），
// 由各消费包自己的 devDependencies 满足 —— 和官方 vite 插件依赖 vite 的机制一致。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import { canonicalizeRegionPaths } from "./lib/canonicalize-region-paths.ts";

const root = import.meta.dirname;
const outDir = path.join(root, "dist", "config");
/** @type {unknown} */
const pkgJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象兜底）。
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function asRecord(raw) {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

/**
 * 取依赖表里的包名清单（值即外部化说明符）。
 * @param {string} field
 * @returns {string[]}
 */
function dependencyNames(field) {
  const table = asRecord(asRecord(pkgJson)[field]);
  return Object.keys(table).filter((name) => typeof table[name] === "string");
}

const externalNames = new Set([
  ...dependencyNames("dependencies"),
  ...dependencyNames("peerDependencies"),
]);

/**
 * 说明符的包名段：`@scope/pkg/sub` → `@scope/pkg`，`pkg/sub` → `pkg`。
 * @param {string} id
 * @returns {string}
 */
function packageNameOf(id) {
  const segments = id.split("/");
  if (id.startsWith("@")) {
    return segments.slice(0, 2).join("/");
  }
  return segments[0] ?? id;
}

/**
 * rolldown 外部化判据。
 * @param {string} id
 * @returns {boolean}
 */
const isExternal = (id) => externalNames.has(packageNameOf(id));

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
