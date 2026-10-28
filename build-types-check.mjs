#!/usr/bin/env node
/// <reference types="node" />
// 规范化并校验 dist/types 的声明产物：先改写，再验残余。
//
// 为什么有改写这半步：本包模块之间此前互不引用，声明里不会出现相对 `.ts` 说明符；构建编排
// 模块（lib/build-*.ts）互相引用后，tsc 的声明产物会把 `./build-artifacts.ts` 原样抄进
// .d.ts，而包里没有那个文件（只有同名 .d.ts）——消费方解析类型面时 ERR_MODULE_NOT_FOUND。
// 改写代码与各消费方 build-types.mjs 同源：lib/build-types.ts 的 canonicalizeDeclarationSpecifiers。
//
// 为什么改写之后还要校验：改写规则锚在句法位置上，rolldown/tsc 改了声明写法时可能整段
// 不命中——那时残余说明符必须被这道检查报出来，而不是带着 `.ts` 发布出去。
// `rewriteRelativeImportExtensions` 的主战场是 JS 产物，声明阶段是否同步重写取决于
// tsc 的版本行为，不能依赖它。
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeDeclarationSpecifiers } from "./lib/build-types.ts";

const typesDir = path.join(import.meta.dirname, "dist", "types");

// 声明里相对说明符只出现在 from/import 的引号串里；`from "./x.ts"`、`export * from "../y.mts"`、
// `import("./z.cts")` 三种形态都收进同一条规则。
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
await Promise.all(
  files.map(async (file) => {
    const content = await readFile(file, "utf8");
    const rewritten = canonicalizeDeclarationSpecifiers(content);
    if (rewritten !== content) {
      await writeFile(file, rewritten, "utf8");
    }
  }),
);
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
