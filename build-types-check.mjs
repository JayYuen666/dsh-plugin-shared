#!/usr/bin/env node
/// <reference types="node" />
// 校验 dist/types 的声明产物：相对模块说明符必须已被改写成 `.js`/`.mjs`/`.cjs`，不得残留
// `.ts`/`.mts`/`.cts`。为什么是构建链上的独立一步：`rewriteRelativeImportExtensions` 的
// 主战场是 JS 产物，声明阶段是否同步重写取决于 tsc 的版本行为——不设门，残留说明符会让
// 消费方在运行期以 ERR_MODULE_NOT_FOUND 撞上，且只在解析到那个文件时才炸。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const typesDir = path.join(import.meta.dirname, "dist", "types");

// 声明里相对说明符只出现在 from/import 的引号串里；`from "./x.ts"`、`export * from "../y.mts"`、
// `import("./z.cts")` 三种形态都收进同一条判据。
const RESIDUAL_SPECIFIER =
  /(?:from\s*|import\s*\(\s*)(?<quote>["'])(?<specifier>\.\.?\/[^"']*\.(?:ts|mts|cts))\k<quote>/gu;

/** @returns 目录下全部 .d.ts 文件路径（含子目录），顺序无关 */
async function declarationFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const own = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
    .map((entry) => path.join(dir, entry.name));
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => declarationFiles(path.join(dir, entry.name))),
  );
  return [...own, ...nested.flat()];
}

const files = await declarationFiles(typesDir);
const inspected = await Promise.all(
  files.map(async (file) => {
    const content = await readFile(file, "utf8");
    return {
      file: path.relative(import.meta.dirname, file),
      residuals: [...content.matchAll(RESIDUAL_SPECIFIER)].map((match) => match.groups.specifier),
    };
  }),
);

const offenders = inspected.filter(({ residuals }) => residuals.length > 0);
if (offenders.length > 0) {
  console.error("dist/types 存在残留 .ts 系说明符的声明文件：");
  for (const { file, residuals } of offenders) {
    console.error("文件:", file);
    for (const residual of residuals) {
      console.error("说明符:", residual);
    }
  }
  process.exitCode = 1;
} else {
  console.info("dist/types 声明说明符校验通过");
}
