#!/usr/bin/env node
/// <reference types="node" />
// build-shared.mjs —— build-host.mjs 与 build-config.mjs 的公共代码。
//
// 为什么统一：asRecord / dependencyNames / packageNameOf / isExternal 这四段代码此前在两个构建脚本里
// 各有一份**逐字节相同**的副本，而本包 README 的收录标准恰恰是「同一份样板在两处以上逐字相同地
// 重复才收录进来」——自己给自己开了例外。两份各自漂移的代价已经显现：asRecord 的注释就不一样。
//
// 外部化规则（与全部兄弟包同一条）：dependencies / peerDependencies 一律外部化，产物里保留裸
// 说明符。shared 曾是**唯一**没有 external 选项的 build-host.mjs，理由是「本机运行走源码不走
// dist」——那句只对了一半：本包是**发布件**，消费方安装的是位于 node_modules 里的 dist/，那边没有
// 源码可用。不外部化就把官方 truncateWithoutSplittingSurrogatePair 的函数体复制进 shared 的
// chunk，于是同一进程里官方截断实现有两份身份（宿主一份 + shared dist 一份），而 shared 自己还要
// 为它的行为负责。判断按「包名段」而不是枚举名字：external 的字符串项是精确匹配，子路径说明符
// （如 vitest/config）会被漏掉。
//
// 统一边界：这里只搬**纯机械代码**。两个脚本各自的领域判断留在原地——build-config 的 FACET_PEERS
// （配置部分用的是消费方自备工具链）与 build-host 的 facets 清单都不是逐字相同的，合并即改行为。
//
// 不进 barrel、不进 exports、也不进 files：构建期专用，消费方拿不到也不需要。
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象回退），避免 any 索引。
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
  const table = asRecord(pkgJson[field]);
  return Object.keys(table).filter((name) => typeof table[name] === "string");
}

/**
 * 主模块判断：本模块是否被当作入口直接运行（而不是被 import）。
 *
 * 不能写 `process.argv[1] === import.meta.filename`：`import.meta.filename` 是解析后的真实
 * 路径，而 argv[1] 保留调用方写的那一串——软链、`/tmp` → `/private/tmp` 这类符号链接、以及
 * 大小写不同的盘符都会让两者不同形，于是判断恒为 false、脚本照常退出 0 却什么都没建。
 * 不用 `import.meta.main`：本包 `engines.node` 是 `>=22.12.0`，那个属性在 Node 22 上不存在。
 * @param moduleFile 调用方的 `import.meta.filename`
 * @returns 是否直接运行
 */
export function isMainModule(moduleFile) {
  // 取不到 argv[1] 时落空串，realpathSync("") 自己抛 ENOENT、走下面那条 false 分支。
  const [, argvPath = ""] = process.argv;
  try {
    return realpathSync(argvPath) === realpathSync(moduleFile);
  } catch {
    // 取不到真实路径（被删、无权限）时按「不是入口」处理：判错的代价是脚本什么都不做，
    // 与 import 场景同形，不会把别人的进程当成自己。
    return false;
  }
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
 * 造一个 rolldown 的 external 判定函数：读包根 package.json 的 dependencies + peerDependencies，
 * 按包名段匹配；`extraNames` 供调用方补上本脚本特有的那一批。
 * @param {string} root 包根（通常传 import.meta.dirname）
 * @param {readonly string[]} [extraNames] 额外外部化的包名段
 * @returns {Promise<(id: string) => boolean>}
 */
export async function createIsExternal(root, extraNames = []) {
  const manifestPath = path.join(root, "package.json");
  // 读不到或不是合法 JSON 时给一条写明文件路径的错误：裸的 SyntaxError 只会说「Unexpected token」，
  // 而这个函数是三条构建链的共同前置，报错不写明文件时排查方向会先错到 rolldown 上去。
  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`读不出 ${manifestPath}：${String(error)}`, { cause: error });
  }
  const pkgJson = asRecord(raw);
  // extraNames 也要过 packageNameOf：查询侧拿包名段比，若调用方传的是子路径说明符
  // （如 vitest/config），原样放进 Set 就永远匹配不上——那一批会被静默打进产物。
  const externalNames = new Set([
    ...dependencyNames(pkgJson, "dependencies"),
    ...dependencyNames(pkgJson, "peerDependencies"),
    ...extraNames.map((name) => packageNameOf(name)),
  ]);
  return (id) => externalNames.has(packageNameOf(id));
}
