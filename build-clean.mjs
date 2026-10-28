#!/usr/bin/env node
/// <reference types="node" />
// 清空 dist/，让 `files` 里的 `dist` 只含当期各模块的产出。
// 为什么必须有这一步：`files` 整目录收 dist/，而下面三条产出（build-host、build-config、两份
// tsc 的 declarationDir）都只覆盖写、从不删。模块一旦改名或下掉，上一代产物会作为孤儿继续
// 被发出去，消费方按旧说明符还能 import 到一个源码里已不存在的模块。
import { rm } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(import.meta.dirname, "dist");

// force 只忽略「不存在」，不忽略 EPERM/EBUSY（被占用、权限不足）：那时 dist 没清干净，
// 上一代产物会作为孤儿留在 files 覆盖的目录里被发出去，所以这一支必须判定失败，而不是在栈里崩溃。
try {
  await rm(outDir, { recursive: true, force: true });
} catch (error) {
  console.error("dist 清理失败", outDir, error);
  process.exitCode = 1;
  throw error;
}
console.info("dist cleaned:", outDir);
