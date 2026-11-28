#!/usr/bin/env node
/// <reference types="node" />
// 清空 dist/，让 `files` 里的 `dist` 只含当期各模块的产出。
//
// 为什么必须有这一步：`files` 整目录收 dist/，而每条产出只覆盖写自己这一轮的文件名：
//   · build-host 按相对路径 prune 自己拥有的产物：dist/ 根层 .js（client.js 除外）、
//     历史根声明 index.d.ts 与 dist/build/ 整棵子树；config/ 与 types/ 归别的构建步骤，它不碰；
//   · build-config 只写 dist/config/ 下的产物；
//   · 两份 tsc 只覆盖 dist/types 下同名 .d.ts，不清 declarationDir；
//   · build-client 只写 dist/client.js。
// 模块一旦改名或下掉，上一代的 .d.ts、config 产物、build chunk 会作为孤儿继续被发出去。
// 残留文件本身会随包发布；能否按旧说明符 import 取决于 exports（当前只有 `./internal/tool/*`
// 是通配，其余是显式清单），所以不要把这里写成“旧说明符一定还能导入”。
//
// 目标固定为**本脚本所在包根**的 dist，不是 process.cwd()：脚本从任何工作目录调用都清同一处；
// 日志打印绝对路径，便于与 `npm pack` 的实际内容对照。本脚本不在 `files` 里，消费方拿不到。
// 只有完整 `npm run build` 走这里；`build:client` 是单文件增量，刻意不清空 dist。
import { rm } from "node:fs/promises";
import path from "node:path";
import { isMainModule } from "./build-shared.mjs";

const outDir = path.join(import.meta.dirname, "dist");

/**
 * 清空一个目录；目录不存在视为成功（force 只忽略 ENOENT，EPERM/EBUSY/EACCES 会抛出）。
 * @param {string} dir 目标目录的绝对路径
 * @returns {Promise<void>}
 */
export async function cleanDist(dir) {
  await rm(dir, { recursive: true, force: true });
}

/**
 * CLI 入口：清理失败只报告一次并以非零退出，让 build 链中止；成功才打印 cleaned。
 * @param {{ clean?: (dir: string) => Promise<void>, log?: { info: (...args: unknown[]) => void, error: (...args: unknown[]) => void } }} [options]
 * @returns {Promise<0 | 1>} 退出码
 */
export async function runClean(options = {}) {
  const clean = options.clean ?? cleanDist;
  const log = options.log ?? console;
  try {
    await clean(outDir);
  } catch (error) {
    log.error("dist 清理失败:", outDir, error instanceof Error ? error.message : String(error));
    return 1;
  }
  log.info("dist cleaned:", outDir);
  return 0;
}

if (isMainModule(import.meta)) {
  process.exitCode = await runClean();
}
