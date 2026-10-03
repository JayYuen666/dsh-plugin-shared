#!/usr/bin/env node
/// <reference types="node" />
// 清空 dist/，让 `files` 里的 `dist` 只含当期 facets 的产出。
// 为什么必须有这一步：`files` 整目录收 dist/，而下面三条产出（build-host、build-config、两份
// tsc 的 declarationDir）都只覆盖写、从不删。切面一旦改名或下掉，上一代产物会作为孤儿继续
// 被发出去，消费方按旧说明符还能 import 到一个源码里已不存在的模块。
import { rm } from "node:fs/promises";
import path from "node:path";

const outDir = path.join(import.meta.dirname, "dist");

await rm(outDir, { recursive: true, force: true });
console.info("dist cleaned:", outDir);
