#!/usr/bin/env node
/// <reference types="node" />
// build-shared.mjs —— build-host.mjs 与 build-config.mjs 的公共件。
//
// 为什么收口：asRecord / dependencyNames / packageNameOf / isExternal 这四件此前在两个构建脚本里
// 各有一份**逐字节相同**的副本，而本包 README 的收录判据恰恰是「同一份样板在两处以上逐字同构地
// 重复才收敛进来」——自己给自己开了口子。两份各自漂移的代价已经现形：asRecord 的注释就不一样。
//
// 外部化口径（与全部兄弟包同一条）：dependencies / peerDependencies 一律外部化，产物里保留裸
// 说明符。shared 曾是**唯一**没有 external 选项的 build-host.mjs，理由是「本机运行面走源码不走
// dist」——那句只对了一半：本包是**发布件**，消费方装的是躺在 node_modules 里的 dist/，那边没有
// 源码可走。不外部化就把官方 truncateWithoutSplittingSurrogatePair 的函数体复制进 shared 的
// chunk，于是同一进程里官方截断件有两份身份（宿主一份 + shared dist 一份），而 shared 自己还要
// 为它的行为负责。判据按「包名段」而不是枚举名字：external 的字符串项是精确匹配，子路径说明符
// （如 vitest/config）会被漏掉。
//
// 收敛边界：这里只搬**纯机械件**。两个脚本各自的领域判断留在原地——build-config 的 FACET_PEERS
// （配置面吃的是消费方自备工具链）与 build-host 的 facets 清单都不是逐字同构的，合并即改行为。
//
// 不进 barrel、不进 exports、也不进 files：构建期专用，消费方拿不到也不需要。
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象兜底），避免 any 索引。
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
 * @param {Record<string, unknown>} pkgJson
 * @param {string} field
 * @returns {string[]}
 */
function dependencyNames(pkgJson, field) {
  const table = asRecord(asRecord(pkgJson)[field]);
  return Object.keys(table).filter((name) => typeof table[name] === "string");
}

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
 * 造一个 rolldown 的 external 判据：读包根 package.json 的 dependencies + peerDependencies，
 * 按包名段匹配；`extraNames` 供调用方补上本脚本特有的那一批。
 * @param {string} root 包根（通常传 import.meta.dirname）
 * @param {readonly string[]} [extraNames] 额外外部化的包名段
 * @returns {Promise<(id: string) => boolean>}
 */
export async function createIsExternal(root, extraNames = []) {
  /** @type {unknown} */
  const raw = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const pkgJson = asRecord(raw);
  const externalNames = new Set([
    ...dependencyNames(pkgJson, "dependencies"),
    ...dependencyNames(pkgJson, "peerDependencies"),
    ...extraNames,
  ]);
  return (id) => externalNames.has(packageNameOf(id));
}
