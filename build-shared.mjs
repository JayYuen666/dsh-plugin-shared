#!/usr/bin/env node
/// <reference types="node" />
// build-shared.mjs —— 四个构建脚本（build-host / build-config / build-client / build-clean）的公共
// 入口判断，以及 build-host.mjs 与 build-config.mjs 的公共外部化规则。
//
// 为什么统一：asRecord / dependencyNames / packageNameOf / isExternal 这四段代码此前在两个构建脚本里
// 各有一份**逐字节相同**的副本，而本包 README 的收录标准恰恰是「同一份样板在两处以上逐字相同地
// 重复才收录进来」——自己给自己开了例外。两份各自漂移的代价已经显现：asRecord 的注释就不一样。
//
// 外部化规则（与全部兄弟包同一条）：dependencies / peerDependencies 一律外部化，产物里保留只写
// 包名的模块说明符。shared 曾是**唯一**没有 external 选项的 build-host.mjs，理由是「本机运行走源码不走
// dist」——那句只对了一半：本包是**发布件**，消费方安装的是位于 node_modules 里的 dist/，那边没有
// 源码可用。不外部化就把官方 truncateWithoutSplittingSurrogatePair 的函数体复制进 shared 的
// chunk，于是同一进程里官方截断实现有两份身份（宿主一份 + shared dist 一份），而 shared 自己还要
// 为它的行为负责。判断按「包名段」而不是枚举名字：external 的字符串项是精确匹配，子路径说明符
// （如 vitest/config）会被漏掉。
//
// 入口判断用 `import.meta.main`（Node 22.18 / 24.2 起）：它由宿主按真实入口计算，`node -e` 里
// import 一个脚本、符号链接调用、`/tmp` → `/private/tmp` 这些形态都由它覆盖。旧注释曾以
// `'import.meta.main' in import.meta` 为 false 当作「API 不存在」的证据，但那个探针查的是字面名为
// `import.meta.main` 的属性，恒为 false，证明不了任何事；本机 Node 22.23.2 上该位实际存在。只有
// 原生值不是布尔（非 Node 的 ESM 转换环境）时才回退到 argv/realpath 比较：argv[1] 可能保留符号
// 链接形态，故必须 realpath；空 argv[1] 直接判 false，不借 `realpathSync("")` 的异常（它在 macOS
// 上解析成 cwd，不抛 ENOENT）。
//
// 统一边界：这里只搬**纯机械代码**。两个脚本各自的领域判断留在原地——build-config 的 FACET_PEERS
// （配置部分用的是消费方自备工具链）与 build-host 的 facets 清单都不是逐字相同的，合并即改行为。
//
// 不进 barrel、不进 exports、也不进 files：构建期专用，消费方拿不到也不需要。
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** 包说明符里不允许出现的空白（换行、制表符、空格都算）。 */
const ANY_WHITESPACE = /\s/u;

/**
 * 判断 unknown 是否是 JSON 对象（非 null、非数组）。
 * @param {unknown} raw
 * @returns {raw is Record<string, unknown>}
 */
function isRecord(raw) {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

/**
 * 从 JSON.parse 的 unknown 投影为 Record（非对象 → 空对象回退），避免 any 索引。
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function asRecord(raw) {
  return isRecord(raw) ? raw : {};
}

/**
 * 清单根值必须是对象：合法 JSON 不等于合法 package.json，`null` / 数组 / 标量都要当场拒绝，
 * 否则依赖表会被静默读成空表、本应外部化的依赖被打进产物。
 * @param {unknown} raw
 * @param {string} manifestPath
 * @returns {Record<string, unknown>}
 */
function manifestRecord(raw, manifestPath) {
  if (!isRecord(raw)) {
    throw new TypeError(`${manifestPath} 的根值必须是对象`);
  }
  return raw;
}

/**
 * 只校验本函数依赖的那部分清单结构：两个依赖字段可缺省，存在时必须是对象，值必须是字符串。
 * npm 的版本范围规则不在这里重做。
 * @param {Record<string, unknown>} pkgJson
 * @param {string} manifestPath
 * @returns {void}
 */
function assertDependencyTables(pkgJson, manifestPath) {
  for (const field of ["dependencies", "peerDependencies"]) {
    if (!Object.hasOwn(pkgJson, field)) {
      continue;
    }
    const rawTable = pkgJson[field];
    if (!isRecord(rawTable)) {
      throw new TypeError(`${manifestPath} 的 ${field} 必须是对象`);
    }
    for (const [name, range] of Object.entries(rawTable)) {
      if (name.length === 0) {
        throw new Error(`${manifestPath} 的 ${field} 里有空包名`);
      }
      if (typeof range !== "string") {
        throw new TypeError(`${manifestPath} 的 ${field}.${name} 必须是字符串`);
      }
    }
  }
}

/**
 * extraNames 只收包说明符（可带子路径）；空串、绝对/相对路径、URL 与空白都会让包名段算成
 * 空串或别的键，必须当场拒绝，否则「额外外部化」会静默失效或误伤。
 * @param {unknown} name
 * @returns {void}
 */
function assertPackageSpecifier(name) {
  const segments = typeof name === "string" ? name.split("/") : [];
  const invalid =
    typeof name !== "string" ||
    name.length === 0 ||
    name.includes("\\") ||
    name.includes(":") ||
    name.includes("@", 1) ||
    ANY_WHITESPACE.test(name) ||
    (name.startsWith("@") && !name.includes("/")) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (invalid) {
    throw new TypeError(`extraNames 的项必须是包说明符，不能是空串、路径或 URL：${String(name)}`);
  }
}

/**
 * 取依赖表里的包名清单（返回值即外部化用的说明符）。调用前 assertDependencyTables 已保证值都是字符串。
 * @param {Record<string, unknown>} pkgJson
 * @param {string} field
 * @returns {string[]}
 */
function dependencyNames(pkgJson, field) {
  return Object.keys(asRecord(pkgJson[field]));
}

/**
 * 主模块判断：本模块是否被当作入口直接运行（而不是被 import）。
 *
 * 原生 `import.meta.main` 优先，且 false 就是权威的「不是入口」，不再走 argv 回退——否则
 * `node -e 'import("./build-config.mjs")' ./build-config.mjs` 会把它误判成入口并执行构建。
 * 只有该位不是布尔值时（非 Node 的 ESM 转换环境）才回退：空 argv[1] 与不是 file: 的调用方
 * URL 直接判 false，其余按两边 realpath 比较（argv[1] 可能保留符号链接形态）。
 * @param {{ url: string, main?: boolean }} meta 调用方的 `import.meta`
 * @returns {boolean} 是否直接运行
 */
export function isMainModule(meta) {
  if (typeof meta.main === "boolean") {
    return meta.main;
  }
  const [, argvPath] = process.argv;
  if (!argvPath || !meta.url.startsWith("file:")) {
    return false;
  }
  try {
    return realpathSync(argvPath) === realpathSync(new URL(meta.url));
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
 * 按包名段匹配；`extraNames` 供调用方补上本脚本特有的那一批（同样按包名段归一）。
 * @param {string} root 包根（通常传 import.meta.dirname）
 * @param {readonly string[]} [extraNames] 额外外部化的包说明符
 * @returns {Promise<(id: string) => boolean>}
 */
export async function createIsExternal(root, extraNames = []) {
  // extraNames 先校验再读清单：它完全由调用方控制，错了应立刻指名，不必等文件读完。
  const extraSegments = extraNames.map((name) => {
    assertPackageSpecifier(name);
    return packageNameOf(name);
  });
  const manifestPath = path.join(root, "package.json");
  // 读不到或不是合法 JSON 时给一条写明文件路径的错误：不带文件路径的 SyntaxError 只会说「Unexpected token」，
  // 而这个函数是 build-host 与 build-config 两条构建链的共同前置，报错不写明文件时排查方向会先错到 rolldown 上去。
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`读不出 ${manifestPath}：${String(error)}`, { cause: error });
  }
  const pkgJson = manifestRecord(raw, manifestPath);
  assertDependencyTables(pkgJson, manifestPath);
  const externalNames = new Set([
    ...dependencyNames(pkgJson, "dependencies"),
    ...dependencyNames(pkgJson, "peerDependencies"),
    ...extraSegments,
  ]);
  return (id) => externalNames.has(packageNameOf(id));
}
