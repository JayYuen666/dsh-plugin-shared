#!/usr/bin/env node
/// <reference types="node" />
// 构建 dist/*.js：rolldown 把源文件打成 ESM（node 目标，node: 内建自动外部化）。
// 为什么必须有这一步：Node 对 node_modules 里的 .ts 直接抛
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING（实测），而发布出去的包正是在
// node_modules 里被 dsh 载入的——官方包入口也一律是编译产物（packages/bundle/base
// 的 main 就是 lib/index.js）。本仓源码位于 lib/ 下，故产物落 dist/，不与源码混目录。
// 类型产物：各模块（含 lib/index.ts 与 lib/plugin.ts）由 tsc -p tsconfig.build.json 出
// dist/types/*.d.ts；package.json 的 "." 指向 dist/types/plugin.d.ts，与运行期
// dist/plugin.js 的导出面一致（同样的 barrel 成员 + name/apply）。这里不再手写根 d.ts。
// 顶部 node reference：oxlint 类型检查对 .mjs 不自动加载 @types/node，需显式声明
// 才能解析 node:fs/promises、process、import.meta（否则整文件按 error 类型误报 unsafe）。
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import { parseAst } from "rolldown/parseAst";
import { createIsExternal, isMainModule } from "./build-shared.mjs";

const root = import.meta.dirname;
const outDir = path.join(root, "dist");

/** 根层里不归本编排管的产物：build-client.mjs 写的那一份。 */
const FOREIGN_ROOT_ARTIFACTS = new Set(["client.js"]);
/**
 * 本编排历史上产出、现在不再产出的根层文件。单独重跑 host 时要顺手清掉，
 * 否则升级后的 dist 里会永远留着一份没有 exports 指向的旧声明。
 */
const LEGACY_ROOT_ARTIFACTS = new Set(["index.d.ts"]);
/** 本编排独占的产物子目录：只有 buildFacets 的 chunk 会落在这里，可整棵清理。 */
const HOST_SUBDIR = "build";
/**
 * tool-map 的目标只允许稳定模块名。与消费方构建期校验的 `MODULE_NAME`
 * （lib/build-tool-imports.ts）同一条：哈希 chunk、外部包名、带目录的说明符都不该进 JSON。
 */
const STABLE_MODULE_NAME = /^[a-z0-9-]+$/u;
/**
 * 可路由导出名：官方 transform 把成员名编进 `new RegExp("^" + name + "$")`，重建导入时也不补引号；
 * `foo$`、`"a-b"` 这类名字它表达不出来。与 lib/build-tool-imports.ts 的 ROUTABLE_EXPORT_NAME 同一条。
 */
const ROUTABLE_EXPORT_NAME = /^[A-Za-z_]\w*$/u;

// 四段机械代码（asRecord / dependencyNames / packageNameOf / isExternal）与外部化规则都收在
// build-shared.mjs——此前这里与 build-config.mjs 各有一份逐字节相同的副本。
// extraNames 补 react-dom：card-ui 的省略格浮层经 createPortal 用到它，而它只在 devDependencies
// （依赖段判定外置不了，会被整段打进 dist/card-ui 产物）。浏览器侧由宿主平台模块供应
// （消费仓的 client 构建经 REACT_RUNTIME_MODULES 外置的同一位）；把它抬进 peerDependencies
// 是发布契约层面的正改，归用户裁决，这里只先保证产物形状正确。

/** 根 barrel 的模块清单（构建产物汇总进 dist/plugin.js；单模块产物供 `./internal/tool/*` 子路径）。
 *  与 lib/ 下模块的一致性由 test/build-host.test.ts 固定：新增模块只改 lib/ 与 barrel、漏掉这里时，
 *  `./internal/tool/<module>` 的 dist/<module>.js 不会产出。 */
export const facets = [
  "tool-events",
  "card-apply",
  "card-diff",
  "project-key",
  "locale",
  "lesson-bus",
  "text",
  "record",
  "errors",
  "jsonl",
  "job-outcome",
  "path-scope",
  "value",
  "card-form",
  "session-cwd",
  "number",
  "cli-safety",
];

/** barrel 之外还要单独出的入口：lib/index.ts 聚合同运行时行为。
 *  `canonicalize-region-paths` 不进 barrel——它是构建期文本后处理函数，塞进根 barrel 的导入名单
 *  会让每个运行时消费方都为它多一次导入。内部构建已不再调用它（基准由 rolldown 的 `cwd` 固定），
 *  这条子路径保留给外部构建脚本按需取用。
 *  `remote-marker` 同样不进 barrel——它值导入 `@deepseek-ai/dsh-typert-protocol`，而根 barrel
 *  的消费方不都需要这枚值面，塞进去等于逼只取根入口的宿主解析一枚用不到的包。 */
// lib/index.ts 刻意不在这里：根入口 "." 由 dist/plugin.js 提供，而 plugin.js 是 rolldown 展平后的
// 同一份具名导出（外加 name/apply），单独再出一份 dist/index.js 没有任何 exports 指向它。
const entries = [
  "lib/tool.ts",
  "lib/tool-browser.ts",
  "lib/plugin.ts",
  "lib/client-entry.ts",
  ...facets.map((facet) => `lib/${facet}.ts`),
  "lib/canonicalize-region-paths.ts",
  "lib/card-ui.ts",
  "lib/remote-marker.ts",
  // 单实例锁只给宿主侧 `apply` 用：进根 barrel 会让每个运行期消费方为它多一次导入，
  // 而它天然是「谁需要谁按子路径取」的形状（各包 apply 起手抢一把本包私有的服务名）。
  "lib/instance-lock.ts",
  // 虚拟 skill 注册同理：技能名与正文都是各包自己的数据，根 barrel 里没有通用消费方，
  // 进 barrel 只是给每个运行期消费方多一次导入。
  "lib/skill.ts",
  // 占位符插值：六个插件各写过一遍（两派语义），现在只有这一份。同样只走子路径——
  // 消费方是各包的 messages.ts，根 barrel 里没有通用消费方。
  "lib/placeholder.ts",
  // Typert 客户端读取器的公共骨架：类型面引用 typert-protocol，照 remote-marker 的
  // 取舍不进 barrel（根 barrel 的消费方不都需要这枚值面）。
  "lib/typert-client.ts",
  // sessionProjections 新旧两代注册协议的判别件：消费方只有两个，进 barrel 只会让
  // 其余运行期消费方为它多一次导入。
  "lib/session-projection.ts",
  // 限时竞速骨架：零依赖，客户端消费方（dir-prep）从 ./client 取、宿主侧消费方
  // （scrapling）从 ./tool 取；两端都随 shared 的外部化规则处理。
  "lib/with-timeout.ts",
];

/** 构建编排模块：各包 build-*.mjs 的统一实现（host / client / types 编排与通用机械代码）。
 *  消费方是构建脚本而不是插件运行时，故产物单独落 dist/build/——test/dist-size.test.ts 的
 *  运行期预算只量 dist/ 一层，混进去会让「运行期装载成本」的度量把构建期的字节也算进来。 */
export const buildFacets = [
  "build-artifacts",
  "build-host",
  "build-client",
  "build-types",
  "build-tool-imports",
  // 装饰器预转换：各包 build-host.mjs 与 vitest.config.ts 按子路径取用（消费方注入 tsc 入口）。
  "decorator-lowering",
  // 产物 require 调用的 AST 判据：只被 build-client 用，同样属于构建期实现。
  "require-calls",
  // 两条构建期 AST 判据共用的结构遍历：只被上面两个切面取用。
  "ast-walk",
];

/**
 * 写到磁盘项（元组而非数组，Map 构造才拿到 [路径, 文本] 的类型）。
 * @param {string} file
 * @param {string} code
 * @returns {[string, string]}
 */
function artifact(file, code) {
  return [file, code];
}

/** `./record.js` → `record`；只用于 tool.js 的稳定模块名。 */
function moduleNameOf(source) {
  return source.replace(/^\.\//u, "").replace(/\.js$/u, "");
}

/**
 * tool.js 的本地导入名 → 模块名。oxc 展平 export * 后，导出名往往不是本地名
 * （例如 `truncateCodePoints as g`），所以必须先收下 import 的别名。
 * @param {import("@oxc-project/types").Program} ast - dist/tool.js 的 AST
 * @returns {Map<string, string>} 本地名到模块名
 */
function localModulesOf(ast) {
  /** @type {Map<string, string>} */
  const locals = new Map();
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration") {
      continue;
    }
    const moduleName = moduleNameOf(node.source.value);
    for (const specifier of node.specifiers) {
      if (specifier.type === "ImportSpecifier") {
        locals.set(specifier.local.name, moduleName);
      }
    }
  }
  return locals;
}

/**
 * 导出说明符里的导出名。`export { x as "x-y" }` 的右侧可以是字符串字面量。
 * @param {import("@oxc-project/types").ExportSpecifier} specifier - 导出说明符
 * @returns {string} 导出名
 */
function exportedNameOf(specifier) {
  return specifier.exported.type === "Identifier"
    ? specifier.exported.name
    : specifier.exported.value;
}

/**
 * 一条导出属于哪个稳定模块：带 `from` 的直接取来源；否则回查 import 别名。
 * @param {import("@oxc-project/types").ExportSpecifier} specifier - 导出说明符
 * @param {string | undefined} source - `export ... from` 的来源；本地导出为 undefined
 * @param {Map<string, string>} locals - 本地名到模块名
 * @returns {string} 稳定模块名
 */
function moduleOfExport(specifier, source, locals) {
  if (source !== undefined) {
    return moduleNameOf(source);
  }
  if (specifier.local.type !== "Identifier") {
    throw new Error(`dist/tool.js 的导出 ${exportedNameOf(specifier)} 不是本地标识符`);
  }
  const moduleName = locals.get(specifier.local.name);
  if (moduleName === undefined) {
    throw new Error(`dist/tool.js 的导出 ${exportedNameOf(specifier)} 找不到定义模块`);
  }
  return moduleName;
}

/**
 * 一条导出说明符的稳定模块归属与可用性。
 *
 * 四类失败都在这里统一拦截：default、非稳定模块名、目标入口不存在、目标入口不导出该名字。
 * 最后一条是消费方装载期 SyntaxError 的唯一前置拦截（shared 在消费方是 external，
 * 打包器不会替裸说明符校验具名导出）。
 * @param {import("@oxc-project/types").ExportSpecifier} specifier
 * @param {string | undefined} source
 * @param {Map<string, string>} locals
 * @param {ReadonlyMap<string, ReadonlySet<string>>} availableByModule
 * @returns {{ exported: string, moduleName: string }}
 */
function stableModuleOf(specifier, source, locals, availableByModule) {
  const exported = exportedNameOf(specifier);
  if (exported === "default") {
    throw new Error("dist/tool.js 有 default 导出：./tool 只发布具名导出");
  }
  if (!ROUTABLE_EXPORT_NAME.test(exported)) {
    throw new Error(
      `dist/tool.js 的导出名 ${exported} 无法被官方 transform 路由；` +
        "成员名必须是 ASCII 标识符（不能含正则元字符或写成字符串字面量）",
    );
  }
  const rawModule = moduleOfExport(specifier, source, locals);
  // code-points 的共享 chunk 文件名带内容哈希，但它由 text.ts 再导出，归到稳定的 text 入口。
  const moduleName = rawModule.startsWith("code-points-") ? "text" : rawModule;
  if (!STABLE_MODULE_NAME.test(moduleName)) {
    throw new Error(
      `dist/tool.js 的导出 ${exported} 指向非稳定模块名 ${moduleName}；` +
        "tool-map 只接受小写字母、数字与连字符组成的入口模块名",
    );
  }
  const available = availableByModule.get(`${moduleName}.js`);
  if (available === undefined) {
    throw new Error(
      `dist/tool.js 的导出 ${exported} 指向 ${moduleName}，但没有产出 dist/${moduleName}.js；` +
        "共享 chunk 必须由某个入口再导出后才能进 tool-map",
    );
  }
  if (!available.has(exported)) {
    throw new Error(
      `dist/tool.js 的导出 ${exported} 指向 ${moduleName}，但 dist/${moduleName}.js 不导出该名字；` +
        "internal/tool/* 的消费方会在装载期直接 SyntaxError",
    );
  }
  return { exported, moduleName };
}

/**
 * 收集 dist/tool.js 里的具名导出说明符；不支持的形态在这里直接失败。
 *
 * 本地声明导出（export const/function/class）没有稳定模块可归属：rolldown 当前会把它们
 * 折进导出说明符列表（随后由 moduleOfExport 报「找不到定义模块」），但输出形态一旦变化，
 * 跳过它们就会退回「构建成功、map 缺项」。所以这里不猜，直接给指向修法的错误。
 * @param {import("@oxc-project/types").Program} ast
 * @returns {{ specifier: import("@oxc-project/types").ExportSpecifier, source: string | undefined }[]}
 */
function namedExportsOf(ast) {
  /** @type {{ specifier: import("@oxc-project/types").ExportSpecifier, source: string | undefined }[]} */
  const rows = [];
  for (const node of ast.body) {
    if (node.type === "ExportAllDeclaration") {
      throw new Error(
        `dist/tool.js 出现未展开的 export *（${node.source.value}），无法生成模块映射`,
      );
    }
    if (node.type === "ExportDefaultDeclaration") {
      throw new Error(
        "dist/tool.js 有 default 导出：./tool 只发布具名导出，default 无法映射到 internal/tool/*",
      );
    }
    if (node.type === "ExportNamedDeclaration") {
      const { declaration } = node;
      if (declaration !== null) {
        throw new Error(
          "dist/tool.js 出现本地声明导出：./tool 的每个导出都必须从 lib/<module>.ts 再导出，" +
            "否则无法映射到 internal/tool/* 的稳定模块",
        );
      }
      for (const specifier of node.specifiers) {
        rows.push({ specifier, source: node.source?.value });
      }
    }
  }
  return rows;
}

/**
 * 从已经打好的 dist/tool.js 反推「导出名 → 稳定模块名」。
 *
 * 三条判据缺一不可：
 *   1. 文本面（AST）给出名字与来源（namedExportsOf / stableModuleOf）；
 *   2. `chunkExports`（rolldown 对该入口 chunk 记录的导出面）与文本面逐名对账——
 *      解析器漏掉的形态会在这里暴露，而不是写出缺项 JSON；
 *   3. `availableByModule` 证明目标入口真的导出该名字（见 stableModuleOf）。
 * @param {string} code - dist/tool.js 的正文
 * @param {readonly string[]} chunkExports - rolldown 交回的 tool.js 导出名
 * @param {ReadonlyMap<string, ReadonlySet<string>>} availableByModule - 入口文件名 → 导出名集合
 * @returns {Record<string, string>} 导出名到模块名的映射（按名排序）
 */
function toolMapOf(code, chunkExports, availableByModule) {
  const ast = parseAst(code, { lang: "js" }, "dist/tool.js");
  const locals = localModulesOf(ast);
  /** @type {Map<string, string>} */
  const exports = new Map();
  for (const { specifier, source } of namedExportsOf(ast)) {
    const { exported, moduleName } = stableModuleOf(specifier, source, locals, availableByModule);
    exports.set(exported, moduleName);
  }

  if (exports.size === 0) {
    throw new Error("dist/tool.js 没有解析出任何导出，不能生成模块映射");
  }
  const declared = new Set(chunkExports);
  const missing = [...declared].filter((name) => !exports.has(name));
  const extra = [...exports.keys()].filter((name) => !declared.has(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "dist/tool.js 的导出面与模块映射不一致：" +
        `缺 ${missing.join(", ") || "无"}；多 ${extra.join(", ") || "无"}`,
    );
  }
  return Object.fromEntries(
    [...exports.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * 把一组入口打成 chunk 并返回产物与导出元数据。
 *
 * 三个判据在写盘前完成：非 chunk 资产直接报错（asset 不会被静默丢掉）、同名入口直接报错
 * （[name] 会互相覆盖）、每个入口的预期产物必须真的产出（rolldown 静默少一件时不会红）。
 * @param {readonly string[]} inputEntries 入口源码清单
 * @param {string} entryFileNames 产物名模板（构建编排组带 `build/` 前缀落子目录）
 * @param {string} chunkFileNames 共享 chunk 名模板
 * @param {(id: string) => boolean} isExternal 外部化判据（每个入口组共用一份）
 * @returns {Promise<{ artifacts: [string, string][], entryFiles: Set<string>, exportsByFile: Map<string, readonly string[]> }>}
 */
async function bundleGroup(inputEntries, entryFileNames, chunkFileNames, isExternal) {
  const bundle = await rolldown({
    input: inputEntries.map((entry) => path.join(root, entry)),
    platform: "node",
    external: isExternal,
    // 模块横幅的路径基准是 rolldown 的 `cwd`（缺省才是 process.cwd()）。固定成包根，
    // 同一份源码在任何调用方 cwd 下都产出同一串字节；不再需要文本后处理。
    cwd: root,
    resolve: { extensions: [".ts", ".mjs", ".js"] },
  });
  /** @type {import("rolldown").OutputChunk[]} */
  let chunks;
  /** @type {Map<string, readonly string[]>} */
  let exportsByFile;
  try {
    const { output } = await bundle.generate({
      format: "esm",
      entryFileNames,
      chunkFileNames,
      // 压缩：实测同一批入口压后只有未压缩态的一小部分。本包的 dist 就是发布形态，
      // 消费方把它当 external 直接 import（不再二次打包），所以这些字节是真实装载成本。
      // 官方根 tsdown.config.ts 同样没开 minify，但那是 monorepo 内消费，与这里的处境不同。
      // 唯一变大的入口是 barrel：oxc 会把 re-export 的具名清单展开。
      // 它多出的那几个字节远小于整批的缩减，仍然值得。
      minify: true,
    });
    const assets = output.filter((item) => item.type !== "chunk");
    if (assets.length > 0) {
      // 资产不会被写盘，静默过滤等于发布一个缺资源的包；构建配置一旦引入 ?url/CSS 就要先改这里。
      throw new Error(
        `rolldown 产出了非 chunk 产物：${assets
          .map((item) => `${item.type}:${item.fileName}`)
          .join(", ")}；本编排只发布 JS chunk`,
      );
    }
    chunks = output.filter((item) => item.type === "chunk");
    if (chunks.length === 0) {
      throw new Error("rolldown generate returned no chunk output");
    }
    exportsByFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk.exports]));
  } finally {
    // bundle 持有 worker 与文件句柄：不 close 时循环里反复建实例会把它们积累到进程退出。
    // 放在 finally 里，generate 抛错（入口解析失败、asset 拒绝等）也照样关。
    await bundle.close();
  }

  const expected = inputEntries.map((entry) =>
    entryFileNames.replace("[name]", path.basename(entry).replace(/\.[^.]+$/u, "")),
  );
  const duplicated = expected.filter((name, index) => expected.indexOf(name) !== index);
  if (duplicated.length > 0) {
    throw new Error(`入口名重复，[name] 占位符会互相覆盖：${duplicated.join(", ")}`);
  }
  const produced = new Set(chunks.map((chunk) => chunk.fileName));
  const absent = expected.filter((name) => !produced.has(name));
  if (absent.length > 0) {
    throw new Error(`rolldown 没有产出入口产物：${absent.join(", ")}`);
  }
  return {
    artifacts: chunks.map((chunk) => artifact(path.join(outDir, chunk.fileName), chunk.code)),
    entryFiles: new Set(expected),
    exportsByFile,
  };
}

/**
 * 打出全部入口，返回「写到磁盘绝对路径 → 文件文本」。多入口由 rolldown 自动
 * code-split，共用实现只落一份 chunk；构建编排模块另起一组 rolldown，产物落 dist/build/
 * （两组之间不共享 chunk，运行期模块不会为构建编排代码多付一个共享 chunk 的字节）。
 * @returns {Promise<Map<string, string>>}
 */
export async function buildHost() {
  // 清单读取放在 buildHost 里而不是模块顶层：导入 `facets` 的测试不该为了拿一份清单就
  // 在 import 期失败；同进程第二次构建也能看到 package.json 的新内容（外部化规则随之更新）。
  const isExternal = await createIsExternal(root, ["react-dom"]);
  const rootGroup = await bundleGroup(entries, "[name].js", "[name]-[hash].js", isExternal);
  const buildGroup = await bundleGroup(
    buildFacets.map((facet) => `lib/${facet}.ts`),
    "build/[name].js",
    "build/[name]-[hash].js",
    isExternal,
  );
  const files = [...rootGroup.artifacts, ...buildGroup.artifacts];

  const toolFile = path.join(outDir, "tool.js");
  const tool = files.find(([file]) => file === toolFile);
  if (tool === undefined) {
    throw new Error("构建产物里没有 dist/tool.js，无法生成 internal/tool 的模块映射");
  }
  const toolChunkExports = rootGroup.exportsByFile.get("tool.js");
  if (toolChunkExports === undefined) {
    throw new Error("rolldown 没有交出 dist/tool.js 的导出元数据，无法核对模块映射");
  }
  const availableByModule = new Map(
    Array.from(rootGroup.entryFiles, (fileName) => [
      fileName,
      new Set(rootGroup.exportsByFile.get(fileName)),
    ]),
  );
  files.push(
    artifact(
      path.join(outDir, "tool-map.json"),
      `${JSON.stringify(toolMapOf(tool[1], toolChunkExports, availableByModule), null, 2)}\n`,
    ),
  );

  // 真正会互相覆盖的只有相同的最终路径；两个组的同名入口落在不同目录，不算冲突。
  const seen = new Set();
  for (const [file] of files) {
    if (seen.has(file)) {
      throw new Error(`产物路径重复：${file}`);
    }
    seen.add(file);
  }
  return new Map(files);
}

/** 相对路径统一成 POSIX：Windows 的 `path.relative` 会给反斜杠，而清单键按 POSIX 比。 */
function toPosix(file) {
  return file.split(path.sep).join("/");
}

/**
 * 列出目录下的 .js（递归），`prefix` 以斜杠结尾。目录不存在视为没有文件。
 * @param {string} dir
 * @param {string} prefix
 * @param {string[]} out
 * @returns {Promise<void>}
 */
async function collectJsFiles(dir, prefix, out) {
  let children;
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  for (const entry of children) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- 顺序下沉，目录层数个位数；并发只换来 fd 压力
      await collectJsFiles(path.join(dir, entry.name), `${rel}/`, out);
      continue;
    }
    if (entry.name.endsWith(".js")) {
      out.push(rel);
    }
  }
}

/**
 * 把内存产物写到目标目录，并只清理本编排拥有的陈旧文件。
 *
 * 拥有面按**相对路径**判定，而不是 basename：
 *   · 根层 `*.js`（`client.js` 归 build-client.mjs，保留）与历史根声明 `index.d.ts`；
 *   · `build/` 整棵子树的 `*.js`（该目录由本编排独占）。
 * `config/` 与 `types/` 归 build-config 与 tsc，不在这里动。basename 比对会把
 * `dist/ast-walk.js` 与 `dist/build/ast-walk.js` 当成同一件产物而留下旧根文件，也会让
 * 换哈希的 `dist/build/*.js` 永远留在盘上。
 * @param {Map<string, string>} built buildHost() 交回的「包内绝对路径 → 正文」
 * @param {string} [targetDir] 目标 dist；测试可指向临时目录
 * @returns {Promise<{ artifacts: number, pruned: string[] }>} 写入件数与删掉的相对路径（已排序）
 */
export async function materialize(built, targetDir = outDir) {
  const artifacts = Array.from(built.entries(), ([file, code]) => {
    const rel = toPosix(path.relative(outDir, file));
    return { file: path.join(targetDir, rel), code, rel };
  });
  await mkdir(targetDir, { recursive: true });
  await Promise.all(
    artifacts.map(async ({ file, code }) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, code, "utf8");
    }),
  );

  const known = new Set(artifacts.map(({ rel }) => rel));
  /** @type {string[]} */
  const pruned = [];
  const rootEntries = await readdir(targetDir, { withFileTypes: true });
  await Promise.all(
    rootEntries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".js") &&
          !FOREIGN_ROOT_ARTIFACTS.has(entry.name) &&
          !known.has(entry.name),
      )
      .map(async (entry) => {
        await unlink(path.join(targetDir, entry.name));
        pruned.push(entry.name);
      }),
  );

  await Promise.all(
    Array.from(LEGACY_ROOT_ARTIFACTS, async (name) => {
      if (known.has(name)) {
        return;
      }
      try {
        await unlink(path.join(targetDir, name));
        pruned.push(name);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }),
  );

  /** @type {string[]} */
  const buildFiles = [];
  await collectJsFiles(path.join(targetDir, HOST_SUBDIR), `${HOST_SUBDIR}/`, buildFiles);
  await Promise.all(
    buildFiles
      .filter((rel) => !known.has(rel))
      .map(async (rel) => {
        await unlink(path.join(targetDir, ...rel.split("/")));
        pruned.push(rel);
      }),
  );
  return { artifacts: artifacts.length, pruned: pruned.toSorted() };
}

async function main() {
  const built = await buildHost();
  const { artifacts, pruned } = await materialize(built);
  console.info("host built:", artifacts, "files -> dist/");
  if (pruned.length > 0) {
    console.info("pruned stale chunks:", pruned.join(", "));
  }
}

if (isMainModule(import.meta)) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
