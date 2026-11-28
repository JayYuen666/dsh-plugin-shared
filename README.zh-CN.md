<p align="center">
  <img src="https://cdn.jsdelivr.net/gh/JayYuen666/dsh-plugin-shared@main/icon.svg" width="96" height="96" alt="dsh-plugin-shared logo" />
</p>

<h1 align="center">dsh-plugin-shared</h1>

<p align="center"><em>dsh 插件家族共用的库包：一份工具事件记录表、卡片状态骨架、一套统一设置卡 UI、一个项目键与一组 locale 支持——只被插件 import，不由用户启用。</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/v/@jayyuen66/dsh-plugin-shared?style=flat-square&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@jayyuen66/dsh-plugin-shared"><img src="https://img.shields.io/npm/d18m/@jayyuen66/dsh-plugin-shared?style=flat-square" alt="npm downloads (total)" /></a>
  <a href="https://github.com/JayYuen666/dsh-plugin-shared/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/JayYuen666/dsh-plugin-shared/ci.yml?branch=main&style=flat-square&label=ci" alt="ci" /></a>
  <img src="https://img.shields.io/badge/license-MIT-4c1?style=flat-square" alt="MIT" />
  <img src="https://img.shields.io/badge/node-%5E24.22.3%7C%7C%3E%3D26.13.1-4c1?style=flat-square&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/dsh-%5E0.2.3--alpha.2-658EFF?style=flat-square" alt="dsh" />
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by_dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white" alt="powered by dsh" /></a>
</p>

<p align="center">
  <img src="https://skillicons.dev/icons?i=typescript,nodejs,vitest,githubactions" alt="tech stack" />
</p>

<p align="center">
  <a href="https://github.com/JayYuen666"><img src="https://img.shields.io/badge/GitHub-JayYuen666-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" /></a>
  <a href="mailto:cqwkkj@gmail.com"><img src="https://img.shields.io/badge/Email-cqwkkj@gmail.com-EA4335?style=flat-square&logo=gmail&logoColor=white" alt="Email" /></a>
  <a href="https://twitter.com/JayYuen666"><img src="https://img.shields.io/badge/Twitter-X%2FJayYuen666-000000?style=flat-square&logo=x&logoColor=white" alt="Twitter/X" /></a>
  <a href="./README.md"><img src="https://img.shields.io/badge/lang-English-658EFF?style=flat-square" alt="English" /></a>
</p>

**一个 [dsh](https://github.com/deepseek-ai/deepseek-harness) 库包：同一作者的插件家族共用的运行期模块与 lint/test 基线。它只被插件包 import，用户不会启用它。**

## <img src="https://api.iconify.design/lucide/file-text.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 目录

- [ 目录](#-目录)
- [ 它做什么](#-它做什么)
  - [收录边界](#收录边界)
- [ 安装](#-安装)
  - [依赖要求](#依赖要求)
  - [shared 的版本下限](#shared-的版本下限)
  - [随包发什么](#随包发什么)
- [ 确认它在正常工作](#-确认它在正常工作)
- [ 它不提供什么](#-它不提供什么)
- [ 模块清单](#-模块清单)
- [ config 导出](#-config-导出)
- [ 已知边界](#-已知边界)
- [ 数据与隐私](#-数据与隐私)
- [ 版本与兼容](#-版本与兼容)
- [ 常见问题](#-常见问题)
- [ 开发](#-开发)
- [ 反馈](#反馈)
- [ 许可](#-许可)

## <img src="https://api.iconify.design/lucide/shield.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 它做什么

- **它是库加一条客户端行，不是独立组合包。** 宿主半由各插件 import；`package.json` 声明 `dsh.client` 并导出 `./client`，由各消费者在自己的 `cordis.patch.yml` 里以 `- id: dsh-plugin-shared` 启用。它没有 `dsh.bundle.patch`，所以单独安装本包不会新增 profile 层、设置卡或路由。固定 id 会让这条行在插件页显示成一个组件，**必须保持开启**：停用后所有设置卡失去组件供应，下一次页面加载会报 `missed the module table`。多个消费者插入同一个 id 时，宿主会把开关标成“无法唯一定位”并禁用。
- **两条使用路径是刻意分开且互斥的。** 宿主/工具侧运行期代码只从 `./tool` 取；浏览器客户端半只从 `./client` 取。旧的 `./tool/<模块>` 与 `./lib/<模块>` 运行期别名已经删除，只有构建辅助保留 `./lib/build-*`、`./lib/decorator-lowering`、`./lib/canonicalize-region-paths` 与 `./config/*`。单一 `./tool` barrel 让消费方只写一行 import，内部由 `dist/tool.js` 转出 20 个工具模块；`browser` 条件把同一说明符指向 `dist/tool-browser.js`，双用源在客户端构建时只取浏览器可执行的那部分模块，不会顺着 barrel 把 `node:fs` / `node:crypto` 拖进浏览器 bundle。额外有一条 **构建期内部面** `./internal/tool/*`：它只供消费方构建器把 `/tool` 的具名导入按 `dist/tool-map.json` 拆到稳定模块，源码侧仍然只写 `/tool`，任何消费方文件都不得直接 import 这条内部面。消费方构建脚本调用 `./lib/build-tool-imports` 的 `toolImportTransform`，由它补上官方 `@rolldown/plugin-transform-imports` 不覆盖的 type-only 收窄、入口形状与再导出守卫；官方插件与本仓的 `parseAst` 由消费方注入。
- **它收录的是各插件逐字重复的部分：**
  - 工具事件记录表（`./tool`）：一次扫描把 `SessionEvent[]` 变成调用表与结果表，PTC 子调用一并合并；`editPathOf` 提取其中可见的编辑目标，`applyPatchTargetsOf` / `editPathsOf` 用官方 `dsh-fs-patch` 解析多文件补丁并展开全部写目标。
  - 客户端卡片基础组件（由 `./client` 导出）：跨 HMR 保证 apply 幂等的保护逻辑，以及把 `null`、`undefined` 与键缺失当成同一种值的表单差异比较。
  - 运行期工具（单一 `./tool` barrel：`tool-events`、`project-key`、`locale`、`lesson-bus`、`text`、`record`、`errors`、`jsonl`、`job-outcome`、`path-scope`、`value`、`session-cwd`、`number`、`cli-safety`、`remote-marker`、`instance-lock`、`skill`、`placeholder`、`session-projection`、`with-timeout`）：各个插件原本都要重写一遍的小逻辑。
  - 构建期与检查基线（`./lib/canonicalize-region-paths`、`./lib/build-tool-imports`、`./config/*`）：产物路径规范化，加上给每个消费方的 oxlint、vitest 与 tsconfig 起点。
- **它只做通用处理，不做领域决策。** 哪些工具算编辑、路径怎么过滤、预算多大、检查何时该报错，都留在各插件。共享层对交给它的领域不做判断。

### 收录边界

- **逐字相同是收录标准。** 同一份函数体在两处以上出现才收录。看起来相似、但失败语义、缓存方式或覆盖方式不同的，留在原地。
- **领域判定留在外面。** 依赖某个插件自己的工具清单、策略或面向用户的措辞的谓词，不是样板，即使它出现了两次。
- **发布出去的接口就是承诺。** 新增模块要把再导出加到正确的 barrel（根入口、`./tool` 或 `./client`；构建期辅助只走子路径），再补构建脚本入口与用例；没有逐模块的运行期子路径要加，`tsconfig.build.json` 的 `lib/**/*.ts` 是 glob，不需要逐模块改。漏了 barrel、exports 或构建入口会被「开发」一节的一致性检查判定失败。

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 安装

```sh
npm install @jayyuen66/dsh-plugin-shared
# 或
pnpm add @jayyuen66/dsh-plugin-shared
```

把它声明成插件包的普通依赖，按裸包名子路径导入：

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/tool";
```

终端用户不需要单独安装或启用它：任一消费包安装时都会自动包含它。它缺失时的失败是 `ERR_MODULE_NOT_FOUND`（那条说明符指向 `@jayyuen66/dsh-plugin-shared/...`），不会静默变成其他行为。本包没有 default 导出；请从 barrel 或子路径使用具名导入。

| 要求 | 值 |
| --- | --- |
| Node.js | `^24.22.3 || >=26.13.1`——逐字照抄宿主的 Node 地板：24.22.3 起的 24.x，或 26.13.1 及以后；Node 25 与宿主一样不在窗口内 |
| dsh | `^0.2.3-alpha.2`，声明为 **optional** peer（import 本包不需要宿主存在） |
| 模块形态 | 仅 ESM。`require()` 只在支持 `require(esm)` 的 Node 上可用 |
| Tree shaking | `"sideEffects": false` |

- **宿主窗口是滚动的。** 本包对着 `devDependencies` 里精确锁定的开发线取证；`engines.dsh` 与 peer 里的范围只是装载门与编译期纪律，不等于取证范围。窗口滚动意味着同步移动这些钉版、重跑宿主对照断言并重新发布。

### 依赖要求

`dependencies` 只有 `@deepseek-ai/dsh-fs-patch` 一枚纯解析器例外；其余 `@deepseek-ai/*` 只出现在 `peerDependencies` 与 `devDependencies` 里。`test/publish-manifest.test.ts` 固定了这条要求，理由是一次启动期故障，不是风格偏好：

- **`@deepseek-ai/dsh-fs-patch` 是唯一允许的普通依赖。** 它是无状态纯解析器，不承载服务实例或模块级身份，多一份不会分裂 `Symbol`；随包安装是为了让宿主窗口内没有该包的版本也能解析 `apply_patch` 语法。其余宿主包仍然必须留在 peer/dev。
- **宿主包写进 `dependencies` 会让消费方的宿主无法工作。** profile 用 `nodeLinker: hoisted` 与 `autoInstallPeers: false` 安装，于是列在 `dependencies` 里的宿主包会被安装成真实目录，与宿主进程已加载的那份并存。`@deepseek-ai/dsh-tools` 的工具运行期调度键是普通 `Symbol`（不是 `Symbol.for`），符号身份按模块实例计算：宿主从副本上读那个键得到 `undefined`，于是每一次原生工具调用都抛错。构建、类型检查与测试在此之前全部通过；这条不变式只能写在 manifest 上。
- **`@deepseek-ai/dsh-output-retention` 是唯一必需 peer。** 它是值导入（`truncateEnd`），运行期由宿主提供；在 `peerDependenciesMeta` 里明写成 `"optional": false`，不靠"没写就等于必需"，因为没写进那张表对 npm 7+ 就是硬要求。
- **其余 peer 都是 optional。** 除裸 `@deepseek-ai/dsh`（只声明宿主版本线）外，它们大多只承载类型声明；两个按子路径收窄的值导入 peer 是例外：`react` 被 `./client` 按值导入，`@deepseek-ai/dsh-typert-protocol` 被 `./tool` 按值导入。两者仍是 optional，只有取用对应子路径的消费方才需要它们在场。`devDependencies` 保存精确的开发线，其中包括经 `dsh-session` 进入类型面的 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/dsh-util-values`、PTC 两个载荷的官方真源 `@deepseek-ai/dsh-tool-executor-ptc`，以及 `ToolErrorIdentity` 的真源 `@deepseek-ai/dsh-tools`。profile 不装 peer，所以不会产生副本。
- **版本要求把装载门与构建基线分开。** 每条 `@deepseek-ai/dsh-*` peer 与 `engines.dsh` 写同一条窗口——`^0.2.3-alpha.2`，单条宿主线。caret 的预发布比较只吃自己那条 patch 元组，所以 `^0.2.3-alpha.2` 收得进 `0.2.3-alpha.2` 与 `0.2` 线上更晚的正式版/预发布，收不进 `0.2.2` 及更早的版本；宿主自己那道比较带 `{includePrerelease:true}`，正是这一档让同元组预发布参与。代价是量出来写在这里的：npm 逐条 peer 独立解析，宿主家族每一枚包内部又把自己的那条线精确钉住（`0.2.3-alpha.2` 要求 cordis `~4.2.0-alpha.1`、schemastery `~3.20.0-alpha.1`），所以消费者把宿主钉在旧线时仍可能止步 `ERESOLVE`，同一条树落在受支持的线上则可解。pnpm——本工作区支持、也是宿主 `dsh plugin add` 在用的安装器——两种形状都解得出，只打一条 peer 告警。装载门两边都不受影响，因为宿主比较 `engines.dsh` 时带 `includePrerelease: true`。`devDependencies` 精确锁定本仓编译与测试用的那一线（`0.2.3-alpha.2`），且必须统一：一棵树里只有一份 `dsh-session`，nominal 类型才互相认得。`@deepseek-ai/cordis` 在 `devDependencies` 里精确锁定 `4.2.0-alpha.1`；peer 范围是同一条单线窗口 `^4.2.0-alpha.1`，旧 rc 线的 `||` 并集已不再保留。install-matrix 探针在运行期枚举发布出去的 `exports` 表，不再照抄一份清单。`test/publish-manifest.test.ts` 分别检查这几件事。
- 已知上游类型图前提：发布出去的 `./tool` 声明经 `dsh-session` 触达 `@deepseek-ai/dsh-util-values` 与 `@deepseek-ai/dsh-llm`，并直接点名 `@deepseek-ai/dsh-tool-executor-ptc` 与 `@deepseek-ai/dsh-tools`；开 `skipLibCheck: false` 的消费方必须都能解析到它们。旧限制（`dsh-llm` 声明引用未声明的 `dsh-attachment`）在当前钉住的 `0.2.3-alpha.2` 线上不再复现——用 `skipLibCheck: false` 导入 `./tool` 可通过。`./tool` 的两个消费方（dsh-danger-guard、dsh-quality-gate）为此在 `devDependencies` 里钉了后两枚包，让自己的严格类型检查能解析到它们。

### shared 的版本下限

消费者的 profile 可以用 pnpm `overrides` 把本包钉在某个版本。钉得低于 `./tool` 或 `./client` 首次出现的版本，宿主启动时就会报 `N entries did not activate` 与 `does not provide an export named ...`：包装得上、永远不加载，而任何单仓 CI 都看不见。要钉版本请先对照本包的 `exports` 与 CHANGELOG。

### 随包发什么

- `main` 与 `exports` 只指 `dist/`，不存在第二套源码形态的 manifest。Node 对 `node_modules` 里的 `.ts` 直接抛 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，而发布出去的包正是在那里被载入的，所以产物是必需的。
- `files` 是 `icon.svg`、`dist`、`config/*.json` 与 `README.zh-CN.md`。npm 永远附带 `package.json`、`LICENSE` 与 `README.md`；中文版显式列出才会一起发。
- `publishConfig` 只带 `access` 与 `registry`。把入口字段放在那里容易出错：pnpm 发布时会把它合并到顶层，npm 不会——换一个发布器就会发出一个入口指向 tarball 里不存在文件的包。
- `build` 先删除 `dist/`，再产出运行期、客户端、配置与构建编排产物以及类型声明。根 barrel 的声明同样由 `tsc` 产出（`dist/types/index.d.ts` 与 `dist/types/plugin.d.ts`），因此 `exports["."]` 的 `types` 条件与运行期 `dist/plugin.js` 指向同一个 barrel（含 `name` 与 `apply`）。不再手写根 `.d.ts`，也不再产出无 `exports` 指向的运行期 `dist/index.js`——`dist/plugin.js` 已经带着展平后的具名导出。`build-host` 只按相对路径清理自己拥有的产物：根层 `.js`（`client.js` 除外）、历史根声明 `index.d.ts` 与 `build/` 整棵子树，所以单独重跑 host 不会留下换哈希的旧 chunk；`config/` 与 `types/` 归别的构建步骤。`build-host`、`build-config` 与 `build-client` 都压缩；`test/dist-size.test.ts` 把运行期、客户端、配置与构建编排产物各自限制在字节预算内。
- `prepare` 指向 `build`。消费方从 registry 安装时它不执行；它存在是为了让打包、发布与 workspace link 拿到的都是新鲜 `dist/`。
- 新增运行期模块要同时改：正确的 barrel（根入口模块改 `lib/index.ts`，工具侧改 `lib/tool.ts`，浏览器客户端侧改 `lib/client-entry.ts`）、`exports`、`build-host.mjs` 中对应的构建清单（根 barrel 模块进 `facets`，仅工具侧或客户端侧模块进 `entries`），外加一份 `test/<模块>.test.ts`；`tsconfig.build.json` 的 `lib/**/*.ts` 是 glob，不需要逐模块改。**先判断它属于哪一侧**：工具侧模块从 `lib/tool.ts` 转出，消费方只认单一 `./tool` barrel；浏览器客户端侧从 `lib/client-entry.ts` 的 `/client` 导出，客户端 UI 源码不得反向 import `./tool`。仅工具侧模块（如 `instance-lock`、`skill`、`placeholder`、`remote-marker`）仍由 `lib/tool.ts` 转出，自身产物留在 `entries`；构建期模块（如 `decorator-lowering`）进 `buildFacets`。漏了 barrel、exports 或构建入口会被「开发」一节的一致性检查判定失败。

### 包内按需 chunk

`./lib/build-client` 除了单入口的 `buildClientBundle`，还提供 `buildClientArtifacts`：入口之外再声明几份**包内 chunk**，让体积大的可选依赖（图表库、文档解析器一类）等用户真打开那一页时才下载，而不是把每个消费者的 `client.js` 都撑大。

```ts
const artifacts = await buildClientArtifacts({
  root: import.meta.dirname,
  rolldown,
  header,
  chunks: [{ source: "src/insights-charts.ts", fileName: "client.insights-charts.js" }],
});
await Promise.all(artifacts.map((a) => writeArtifact(path.join(root, a.fileName), a.text)));
```

- **调用方按字面串引用 chunk**：源码里写 `require.async("./client.insights-charts.js")`，宿主按这串字算 chunkId。产物名因此由调用方给定、不由内容 hash 生成——带 hash 就得回头改写入口，产物与源码不再逐字对应。
- **每份产物各起一趟构建**，不走一趟多入口：rolldown 在多入口下会把公共依赖拆成额外 chunk 并用**同步** `require("./client.common.js")` 引用它，而宿主模块表里没有这种包内相对同步边，运行期必然 miss。代价是公共依赖在每个 chunk 各留一份。
- **五道构建期门**拦的都是运行时静默的失效形态：产物名不合宿主的 `client.<name>.js` 规则（`/plugins/<id>/<fileName>` 会按 404 提供）、撞上 `client.node.*` 保留名、同一个名字声明两次、声明了却没被任何 `require.async` 引用（包变大而那一页永远出不来）、以及跨 chunk 的同步 `require`。最后一道排在最前判：产物之间真有静态边时，即使入口也写了 `require.async`，运行期仍先在那条边 miss。
- **chunk 必须自己写进 `files`**，本包只交回正文（`ClientArtifact[]`）、不落盘也不改 manifest。漏登记的表现是本地 link 一切正常、从 registry 装的那份 404。

### 外置规则

`clientExternalPatterns(externals)` 与 `clientReactGuard(externals)` 是构建与消费方自查共用的那一份外置判断，`build-client.mjs` 里两行就能取到：

```ts
const artifacts = await buildClientArtifacts({
  root: import.meta.dirname,
  rolldown,
  header,
  externals: [...REACT_RUNTIME_MODULES, "zod", "@jayyuen66/dsh-plugin-shared/client"],
});
```

- **裸包名泛化，带子路径的登记项精确匹配**。`"zod"` 生成 `^zod(?:/|$)`，`"<shared>/client"` 生成 `^<shared>/client$`。后者不能泛化成整个包名：宿主模块表按说明符全等查键，泛化会把没登记的 `<shared>/lib/record` 也外置出去，产物里多一条加载期必然 miss 的 `require`。
- **react 家族不进 `external` 数组**，由 `clientReactGuard` 的 `resolveId` 守卫接管：登记的返回 `{ id, external: true }`，未登记的**抛错**。正则在 `isResolved:false` 那次判定里先命中就不再问插件，两者放一起会互相遮蔽——未登记的 `react-dom/server` 会被静默外置成宿主模块表里没有的键。
- **第六道构建期门 `assertStaticRequires`** 拦下外置漂移：产物里出现非相对、非绝对、又不在本包登记清单里的静态 `require("<specifier>")` 时当场抛错。它拦的是「包名登记了、子路径没登记」——构建、类型检查、打包三步全绿，只在宿主加载期报 `missed the module table`。
- **minify 时保留法律注释**：`comments` 缺省下发 `{ legal: true, annotation: false, jsdoc: false }`，`/*!` 许可头跟着第三方库进产物；显式传 `comments: false` 才整片抹掉。同时固定 `codeSplitting: false` 与 `dynamicImportInCjs: false`，避免默认行为把动态 import 拆成用**同步** `require` 引用的额外 chunk。

## <img src="https://api.iconify.design/lucide/circle-check.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 确认它在正常工作

1. **子路径能解析。** 在消费包里运行 `node -e 'import("@jayyuen66/dsh-plugin-shared/tool").then((m) => console.log(typeof m.isRecord))'`，输出 `function`。`ERR_MODULE_NOT_FOUND` 表示依赖没装上；`does not provide an export named ...` 表示装到的那份比你 import 的子路径旧。
2. **barrel 能解析。** 换成裸包名做同一件事，应能取到运行期模块。`canonicalize-region-paths`（构建期）、`instance-lock` / `skill` / `placeholder` / `session-projection` / `with-timeout`（根 barrel 没有通用消费方）、`remote-marker`（值导入 typert）、`typert-client`（类型面引用 typert）与 `card-ui`（客户端专用，已收进 `./client`）刻意不在 barrel 里；需要时只从 `./tool` 或 `./client` 取。唯一的逐模块**运行期**子路径是供消费方构建脚本使用的内部 `./internal/tool/*`；构建期辅助保留自己的 `./lib/build-*`、`./lib/decorator-lowering` 与 `./lib/canonicalize-region-paths` 子路径，消费方源码不得直接 import 其中任何一个。
3. **消费方宿主能启动。** 启动声明该插件的 profile。若启动日志出现 `N entries did not activate` 与 `does not provide an export named ...`，说明 profile 的 `overrides` 固定得比包含该子路径的版本低——调高固定版本，不要改插件。
4. **本地源码改动能反映到消费方。** 消费方载入的是 `dist/`，不是 `lib/`。改完先运行 `pnpm run build`；`test/build-host.test.ts` 会把磁盘上的运行期产物与内存构建逐字节比对，产物过期即报错。"代码改了却没生效"多半是产物过期，不是缓存问题。

## <img src="https://api.iconify.design/lucide/circle-slash.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 它不提供什么

- **不声明组合包。** 它为客户端行声明 `dsh.client`，但没有 `dsh.bundle.patch`；`node_modules` 里的副本本身不是 profile 层。客户端行由消费者自己的 patch 启用。
- **没有自己的设置卡。** 客户端行导出卡片组件；本包不注册卡片、不持有客户端状态，也没有路由。
- **没有 HTTP 路由，也没有请求信任检查。** 真正注册路由的插件由宿主的 `/api` 网关负责认证、Host / Origin 校验与 body 上限。
- **没有 CLI 子命令，也没有模型工具。**
- **不做领域判定。** 它不知道哪些工具算编辑、哪条路径是密钥、预算多大、检查何时该报错。这些属于调用方的插件。

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 模块清单

「子路径」是包内说明符，值 import 要带裸包名前缀。`exports` 另含 `./package.json`，供宿主读展示元数据。

运行期只分两侧，另有两类非运行期入口：

| 侧 | 说明符 | 用在哪 | 产物形态 |
| --- | --- | --- | --- |
| 宿主 / 工具 | `./tool` | `host.ts`、`lib/`、Node 侧测试与构建脚本 | 一条 barrel 转出 20 个 `dist/<模块>.js`；`browser` 条件选择浏览器可执行的模块子集 |
| 浏览器客户端 | `./client` | `src/` 里的客户端入口、读取器、设置卡 | 单条 `__ModuleLoader__` UMD 行；客户端 UI 不再从 `./tool` 取 |
| 构建 / 检查辅助 | `./lib/build-*`、`./lib/decorator-lowering`、`./lib/canonicalize-region-paths`、`./config/*` | 构建脚本、lint / vitest / tsconfig | 非运行期 |
| 构建期工具拆分 | `./internal/tool/*` | 消费方 `build-host.mjs` 经 `toolImportTransform` + 官方 transform | 由 `dist/tool-map.json` 驱动；不是公共 API，源码不得直接 import |

| 子路径 | 提供什么 |
| --- | --- |
| `.` | 下面那些**确实进了根入口**的运行期模块的 barrel，由 `dist/plugin.js` 提供：它们的导出名，再加 `name` 与一条空操作的 `apply`，宿主 Loader 因此也能把本包当作一行载入。`canonicalize-region-paths`（构建期）、`instance-lock` / `skill` / `placeholder` / `session-projection` / `with-timeout`（根 barrel 没有通用消费方）、`remote-marker`（值导入 typert）、`typert-client`（类型面引用 typert）与 `card-ui`（客户端专用，已收进 `./client`）刻意不进；根 barrel 不得把用不到的包带进每个消费方 |
| `./tool` · `tool-events` | `scanToolEvents` 返回 `calls` / `results` 两张表，PTC 子调用一并合并；`toolEventRowsOf` 处理单个事件，交回的记录已带归一后的 `arguments` 与 `badArguments`。`editPathOf` 返回按 `kind` 判别的 `EditTarget`，只有 `write` / `read-view` 两个分支；路径取不到时为 `undefined`。`applyPatchTargetsOf` 用官方 `dsh-fs-patch` 解析 `apply_patch` 的有序操作；`editPathsOf` 展开全部写目标（move 的源与目的都算）。记录字段一律 `readonly`；`arguments` 是深快照——先用平台 `structuredClone` 与事件完全隔离，再对 JSON 对象/数组逐层冻结（非 JSON 对象已克隆，但不声称冻结内部槽）。结果行另带结算事件 `data.error` 的结构化失败身份 `error`（`name` / `code` 必须是非空字符串，半截形状按缺席处理；`reason` 只在它是字符串时保留）。同时再导出官方 `SessionEvent` 与 PTC 两个载荷——`PtcDispatchStartEventData` / `PtcDispatchEventData` 与 `SessionEventMap` 增补的真源都是 `@deepseek-ai/dsh-tool-executor-ptc/types`（官方声明自带增补），这里只转发名字，本地声明已删 |
| `./client` · `card-apply` | `claimApply` + `CardApplyCtx`：保证 apply 幂等的保护逻辑，建立在 `globalThis` 上的**自有**标记（symbol，或外部写入的 `true`）加 `ctx.effect` 清理。槽必须是可配置的数据属性；访问器与非占位协议值会明确抛错，而不是被覆盖。标记在同一 `globalThis`（同一 realm）内共享，所以同一页面的第二个 ctx 会被拒绝——这是有意的设计 |
| `./client` · `card-diff` | `formValueEquals` 按表单值语义比较两个值：`undefined`、`null` 与键缺失是同一种值；数组与对象逐元素比较；循环引用也能正常结束。`diffTouched` 返回有效值真的与快照不同的 touched 字段 |
| `./client` · `card-form` | 不依赖 React 的卡片草稿骨架：`numberBoundsOf` 从 zod 数值 schema 读显式 `minValue` / `maxValue`（可带两侧兜底）；`withDraftField` 在 touched 层写一格且不改入参；`effectiveField` 先用 `Object.hasOwn` 判草稿自有键、再经 `Reflect.get` 回落快照，显式 `undefined` 草稿与 `constructor` / `__proto__` 继承名都不会读错 |
| `./client` · `card-ui` | 客户端专用设置卡组件（v3 视觉基线）。表单层：`CardForm`、`Section`（可选 `count` 计数徽章、`toggle` 节级开关与 `actions` 动作位）、`FieldGrid`、`FieldTwoCol`、`StatusBar`、`Field` / `FieldLabel` / `InfoTip`（标签行在上、控件在下；`hint` 与 `detail` 只进 24px 帮助按钮的浮层，校验错误另在标签行显示一枚截断徽标、全文同样进浮层，字段不再长第三行；`TipPlacement` 只有 `side`（字段）与 `above`（小节标题）两档）、`ToggleField`、`SectionToggle`、`ToggleGrid` / `ToggleCell`、`TextField`、`SecretField`（password 输入 + 框内眼睛按钮；`revealToken` 让撤销后回到遮蔽）、`NumberField`、`ListField`、`SelectField`（`bare` 变体给表格单元格与页头筛选，不画 Field 外壳）、`SaveBar`、`splitHint`、`withInvalidField`、`useInvalidFields`、`useCardDraft`（以及 `CardDraft` / `CardDraftOptions` 类型——单份 touched 层状态，用 `Object.hasOwn` 判自有键，可带逐字段 parser，不读继承名）、`InvalidFields` 类型。展示层（v2 引入）：`Badge`（可带 `dot` 色调与 `data-field`）/ `StatusDot`（可带 `label`，只有一颗点的状态列仍可读）、`Callout`、`KpiGrid` / `KpiTile`、`DataTable`（`ellipsis` 列悬停经 `createPortal` 弹全文浮层，可选 `stickyFirst` 冻结首列、`caption` 供读屏表名）/ `Meter`、`LogPanel`、`Segmented`、`EmptyState`（空托盘图标；`plain` 去掉虚线边框）、`ToolRow` / `ToolRowGrid` / `ToolRowItem`，以及样式字符串 `CARD_UI_CSS`。`SaveBar` 的可选 `blocked` 只封保存、保留撤销。四个输入组件（`TextField` / `SecretField` / `ListField` / `NumberField`）各持内部草稿并跟随外部值：聚焦中不采纳外部值、失焦后跟随，跨条目渲染时必须以条目 id 作 `key`，否则实例复用会把上一个条目的草稿与错误提示带进下一个。`CARD_UI_STYLE_ID` 与 `ensureCardUiCss` 把该样式表以固定 `<style id="dsh-card-ui-css">` 幂等注入；引用计数记在 style 元素上，因此各自打包的消费者共用一份，未带该计数的外部 style 不认领、不移除。控件 DOM id 由进程内自增的 `nextDomId` 生成，不依赖 React `useId`——消费仓用自己的轻量 hook 层渲染组件树时，`label[for]` 关联照样成立；`SecretField` 的输入 id 取自字段键。只用 `createElement` 与 `createPortal`；`react` 是 optional peer（`^18.2.0 || ^19.0.0`，宿主运行时是 React 18.3.1），`react-dom` 只被浮层 portal 取用、仅声明在 `devDependencies`（产物保持裸说明符，运行期由宿主平台模块与 react 同一位供应），这套组件永不进根 barrel |
| `./client` | 浏览器客户端行：宿主模块图只提供一份的 `__ModuleLoader__` bundle。它同时承载客户端读取骨架（`remoteMounterOf` / `parseOrThrow` 及 `RemoteHost` / `RemoteMounter` / `SafeParse*` 类型）、`raceTimeout`、`clampInt`，让浏览器半只用一个 import 面，不再伸进 `./tool`。消费者外置这个说明符，并在自己的 patch 里以 `id: dsh-plugin-shared` 启用这一行；该行必须保持开启——停用后各插件设置卡会失去 shared 组件供应，下一次页面加载会报 `missed the module table` |
| `./tool` · `project-key` | `deriveProjectKey` + `ProjectKeyOptions`：cwd → `尾目录名-<sha256(norm) 前 8 位 hex>`；非字符串、空串或归一后的根目录归入 `default`。`realpathSync` 会解析软链接，失败则退回解析后的路径。Windows 的 `\` 与 `/` 产生同一个键；扩展命名空间前缀先分类再判根，`\\?\C:\repo` 不再落 `default` |
| `./tool` · `locale` | `Locale`（官方 `BuiltInLocaleId` 的别名）、`DEFAULT_LOCALE`、`resolveLocale`、`resolveLocalePreference`、`messagesFor`、`MessagesCatalog`，加 `LOCALE_SETTINGS_NAMESPACE` 与 `LOCALE_PREFERENCE_FIELD`。只负责宿主侧字典；客户端用官方 locale 包 |
| `./tool` · `lesson-bus` | `settleLessonCall`：同步抛错与异步 rejection 归到同一个 `onFailure` 出口。函数型 thenable 也算可等待；`onFailure` 自己抛错或拒绝时被统一处理，不会分成"抛给调用方"或"未处理拒绝"两种结果 |
| `./tool` · `text` | `truncateEnd` 转交官方 `truncateWithoutSplittingSurrogatePair`；`truncateStart` 是官方导出内容里没有的后切形式。两者都按代理对安全切；预算不足一个码元（含 `<= 0` 与 NaN）返回空串。`truncateCodePoints` 改按码点预算，emoji 与组合字符各算一个（`NaN` 与 `<= 0` 得空串，`Infinity` 交回整串） |
| `./tool` · `record` | `isRecord`、`fieldOf`、`hasMethods`、`hasOptionalMethods`、`isArrayValue`、`arrayOf`。`fieldOf` 按设计走原型链（cordis 的服务方法定义在那里）；遇到恶意 getter 或 Proxy trap 时改返回 `undefined`，不抛错。`hasMethods` 要求指定的每个方法在本次读取中都是函数，并且不把 `Object.prototype` 的成员当成服务实现；空方法清单不证明任何能力，返回 `false`（只判对象请用 `isRecord`）。`hasOptionalMethods` 同样拒绝非函数值，但允许方法缺席。`isArrayValue` 只把值收窄成 `unknown[]`、不复制；`arrayOf` 对数组原样返回、对任何非数组返回空数组——必需数组字段必须先做校验再调用它 |
| `./tool` · `errors` | `errorText` 对齐官方 `@deepseek-ai/dsh-llm` 的 `errorChain` 语义（cause 链、`AggregateError` 成员、空 message 回退 `name`、跨 realm 取 `message`、恶意 getter 改用占位文本），本地零依赖实现。`isSettingsConflict` 由 `code` / `name` 识别宿主的设置冲突特征，跨 realm 抛来的错误也能识别。`isErrnoCode` / `isEnoent` 从 `code` 读 Node errno 身份（后者只认 `ENOENT`），不靠 message 文本猜 |
| `./tool` · `path-scope` | 「某个绝对路径是否在根之下」的唯一判据：`isPathInside` / `isAncestorDirOf` 按路径组件比较（根内名为 `..cache` 的子目录不会被误判成逃逸），平台 `path` API 由调用方注入，macOS 上也能验 Windows 语义。`normalizeAbsolutePath` 词法解析 `.` / `..`，越过文件系统根的 `..` 直接拒绝；`assertAbsoluteRoot` 再补类型、非空、NUL、该方言绝对性与「不得是文件系统根」四道判据。拒绝文案由调用方按自己的语言表传入 |
| `./tool` · `value` | 零依赖的 `unknown` → 文本/正则片段转换。`asText` 只认字符串、其余返回空串；`asDisplayText` 另外把 number / boolean 转成展示文本，但对象、bigint 与 symbol 仍返回空串；`escapeRegExp` 只转义正则元字符，不加锚点与 flags |
| `./tool` · `number` | `versionAtLeast` 逐段比较 `{ major, minor, patch }` 的数值（不是字符串比较，所以 `0.10.0 > 0.9.0`）；`clampInt` 把非有限数交给 fallback，其余先 trunc 再夹进闭区间 |
| `./tool` · `session-cwd` | `WorkingDirectoryFace` / `WorkingDirectoryService`、`isWorkingDirectory`（`get` 可缺席，供调用方用 `service.get?.()` 回落）、`isWorkingDirectoryService`（严格：`get` 必须是函数）、`sessionWorkingDirectory`（先读活目录 `ctx.get("workingDirectory")`，再回落 `session.header.cwd`）与 `SessionCwdAgent`。宽松判据服务的是「服务可能只装了一半」的读取面；dir-prep 用严格版，因为它的公开 `workingDirectoryOf` 契约把服务交给不再二次判空的调用方 |
| `./tool` · `cli-safety` | `shq(value, platform = "posix")` 把任意字符串放进单引号，支持 `bash` / `sh` 与 PowerShell（`win32`）；含 NUL 一律拒绝，因为 shell 读不回来。单引号内容在两种 shell 里都按字面量保留，差别只在嵌入单引号的写法（`'\''` 与 `''`） |
| `./tool` · `jsonl` | `shrinkJsonlTail`：JSONL 尾部裁剪的纯逻辑模块。触发策略与错误处理留给调用方；字节预算是否有限由调用方保证 |
| `./tool` · `job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome` 把已结束的子进程映射成官方作业注册表的结局；completed 结局同时带官方 `exitCode`，作业列表据此给非零退出码画警告点。`killProc` + `KillableProcess` 释放子进程句柄，对抛错或拒绝的 `kill()` 一律忽略（例如进程已被回收） |
| `./tool` · `instance-lock` | `claimInstance(ctx, key)` + `InstanceLockContext`：在同一个 cordis 作用域里抢一份单实例名额，建立在 `ctx.reflect.provide` 之上、随所属 fiber 释放。它存在的原因是 market 的热挂路径与 profile 的 bundle 层可能在同一个进程里各 `apply()` 一次同一插件——工具、prompt 段落与 `Service` 构造器遇到重名都会抛，所以第二次装配该让路而不是失败。不进根 barrel，且零 import |
| `./tool` · `skill` | `registerSkill(ctx, spec)` + `SkillSpec`：经可选的 `skills` 服务注册一枚虚拟 skill，并始终填上 `source`（缺省 `"runtime"`）——宿主 `validateDefinition()` 在加载全文时要求它。正文为空时不注册；服务缺席或形状不对回 `false` 而不抛。不进根 barrel |
| `./tool` · `placeholder` | `fillPlaceholders(template, values)` + `PlaceholderValues`：单趟 `{name}` 插值。缺值与 `undefined` 保留占位符原文，`null` 渲染成 `"null"`，只取自有属性（键可带点，`{gate.command}` 照样可替换）。不进根 barrel |
| `./tool` · `remote-marker` | `markRemote(prototype, methodName)`：官方 `@Remote` 方法装饰器的程序化等价物。它把同一个装饰器函数作用在手写的 TC39 context 上，源码因此不必写装饰器语法，也不需要降级流水线。按值导入 `@deepseek-ai/dsh-typert-protocol`（optional peer），且不进根 barrel |
| `./client` · `typert-client` | Typert Remote 客户端读取器的公共骨架：`RemoteHost` / `RemoteMounter` 类型、`isRemoteMounter` 守卫、`remoteMounterOf(ctx, strict = false)`（try 读 `remote`，任何失败都折成“没有远程通道”），以及 schema 无关的 `SafeParseSuccess` / `SafeParseFailure` / `SafeParseResult` / `SafeParser` 类型与 `parseOrThrow(schema, value, describe)`。此前七个仓的读取面各有一份逐字或 α-等价副本；骨架只收这些机械件，descriptors、codec、命名空间常量、unwrap 的宽严与错误文案等领域判断留在各仓。`parseOrThrow` 把错误格式化器作为参数注入，因此本包仍不新增 zod 依赖面。类型面引用 `@deepseek-ai/dsh-typert-protocol`（不进根 barrel 的同一取舍） |
| `./tool` · `session-projection` | `ctx.sessionProjections` 新旧两代注册协议的判别件：`ProjectionHandle` / `isDisposer` / `isProjectionHandle` 与 `discriminateProjection`，判序固定（先判 handle 后判 disposer——把可调用性当成 handle 的排除条件时，「可调用 + 带 stateOf/dispose」的合成值会按旧协议处理）。零 import；两仓的挂载主体（失败语义 fail-open / fail-fast 相反）留在原地。不进根 barrel |
| `./tool` · `with-timeout` | `raceTimeout<Value>(promise, timeoutMs, onTimeout)`：「限时等待、到点不再等但底层操作继续跑」的竞速骨架。计时器在成功与超时两端都清掉，不给事件循环留空转定时器；`onTimeout` 到点时构造拒绝值（文案与错误类型属调用方），底层操作不可中止、仍在后台跑完。零依赖、零 import。不进根 barrel |
| `./lib/decorator-lowering` | 标准装饰器的构建/测试辅助：`needsDecoratorLowering`、`lowerStandardDecorators`、`rolldownDecorators`、`viteDecorators`、`tscFailureHeadOf`（信号终止与非零退出的失败头部短语）。它用调用方注入的 `tsc` 入口单文件编译（`--noResolve`，模块说明符逐字保留），交回代码与源映射；Vite 侧还会把注入样板从覆盖率映射里摘掉。仅构建期使用，绝不进运行期 barrel |
| `./lib/canonicalize-region-paths` | 构建期字符串处理：把 rolldown 写下的 `// <路径>`（生产构建）与 `//#region <路径>`（HMR 载荷）按显式基准解析，再按完整路径段判归属。内部构建**不再调用它**——rolldown 的 `cwd` 已固定成包根；子路径保留给无法控制 `cwd` 的外部构建脚本，只应对原始产物处理一次 |

`instance-lock`、`skill`、`placeholder`、`session-projection` 与 `with-timeout` 是根 barrel 没有通用消费方的运行期模块；`card-ui`（值导入 `react`，现仅经 `./client` 导出）、`remote-marker`（值导入 `@deepseek-ai/dsh-typert-protocol`）与 `typert-client`（类型面引用同一枚包）同样不进根 barrel，免得每个 host 侧 importer 都去解析一枚它用不到的包。它们仍可从单一 `./tool` 或 `./client` 面取到。旧的客户端兼容行（`./lib/card-apply`、`./lib/card-diff`、`./lib/card-form`、`./lib/card-ui`、`./lib/typert-client`）已删除，浏览器代码从 `./client` 取。

客户端行由消费插件启用，不由单独安装本包启用。消费者写 `- id: dsh-plugin-shared`、`name: "@jayyuen66/dsh-plugin-shared"`，并**保持开启**；停用后所有需要该行组件的设置卡都会失效，下一次页面加载会报 `missed the module table`。多个消费者插入同一个 id 时，宿主会把该组件的开关标成“无法唯一定位”并禁用。

## <img src="https://api.iconify.design/lucide/sliders-horizontal.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> config 导出

这些是给插件作者用的 lint/test 基线，不是运行期代码。它们依赖你的包自己提供的工具链：

| 子路径 | 提供什么 | 你需要装什么 |
| --- | --- | --- |
| `./config/oxlint` | `definePluginConfig`、`makeTestFileOverrides`、`OFF_JUSTIFICATIONS` 与共享规则基线 | `oxlint`、`eslint-plugin-sonarjs`、`eslint-plugin-regexp`、`eslint-plugin-zod`（需 zod 4）、`@e18e/eslint-plugin` |
| `./config/vitest.base` | `definePackageConfig`：四项 100% 覆盖率阈值、20 秒测试超时、共享覆盖率排除表、用例匹配范围、`@jayyuen66/dsh-plugin-shared/client` → 包内 `dist/client-entry.js` 的别名（UMD 行在装载时就读 `window`，Node 测试执行不了它；别名指向发布产物，因为 `files` 只带 dist）、`react` / `react-dom` 交给 `resolve.dedupe`（不再从 cwd 推断文件系统别名，`react/jsx-runtime`、`react-dom/client` 等子路径仍按原包 exports 解析），把 shared 内联进 Vite 流水线的规则——消费仓的 `vi.mock("react")` 因此能作用到组件，而不是被 Node 加载器绕过；覆盖项里的 `undefined` 一律按“继承”处理（不会被当成“没有阈值”），`test.server.deps.inline` 只许追加，`test.coverage` 在装载时拒绝，`coverageInclude` 的每个模式都要在解析后的测试根下命中文件（源码移位后零命中会让运行直接失败，而不是在无测量对象时照样全绿） | `vitest` 与 `@vitest/coverage-v8`（基线把 `coverage.provider` 固定为 `"v8"`） |
| `./config/tsconfig.base.json`、`./config/tsconfig.client.base.json` | 给 `extends` 用的纯 JSON | 什么都不用 |

这些工具链包**不**写进 `peerDependencies`：npm 7+ 连 optional peer 都会去满足，而 `oxlint` 自己的 `peerOptional vite-plus` 把 `vitest` 锁定在一个与 `>=5.0.2` 无交集的版本上，结果是本包的普通 `npm install` 直接 `ERESOLVE` 失败。这条约束因此写在文档里，而不是 manifest 里。

- 四个 JS plugin（sonarjs / regexp / zod / e18e）的入口都在 `definePluginConfig()` 内部惰性解析。没装任何一条时导入 `./config/oxlint` 仍然成功；调用 `definePluginConfig()` 且该插件既没装、`jsPlugins` 里也没带入口时才抛错，消息里写明试过哪些说明符，以及自备入口的方法。
- `e18e/prefer-static-regex` 只在生产路径开启（`lib/**`、`src/**`、`host.ts`、`cli-main.ts`）；测试与构建脚本里的内联正则不按缺陷处理，理由与实测条数在 `OFF_JUSTIFICATIONS`。
- 基线里每条关闭为 `off` 的规则都要在 `OFF_JUSTIFICATIONS` 里有 `kind` + `measured` + `note`，否则配置加载即抛。包级例外写进那个包自己的 `offReasons`。
- `definePackageConfig` 拒绝空 `coverageInclude`，也拒绝 `test.coverage` 块：两者任一都会让四项阈值或统计范围静默消失。要例外就在需要例外的包自己的 `coverage` 覆盖项旁边写明理由。

## <img src="https://api.iconify.design/lucide/triangle-alert.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 已知边界

按类登记，每类一条；每条都由测试按现状固定。

- **`fieldOf` 刻意走原型链。** 改成 `Object.hasOwn` 会让所有 cordis 服务方法都取不到。读用户设置值的代码必须改用自有属性判断；`resolveLocalePreference` 就是例子，两个方向都有用例覆盖。
- **`claimApply` 共享同一 `globalThis`（同一 realm）内的标记，不是 per-context 锁。** 同一页面上第二个 ctx 申请同一张卡会被拒绝。需要多 ctx 并存的消费方应自己按 ctx 管理，而不是"修"这道保护；iframe / worker 各有自己的 `globalThis`，不共享这份标记。
- **`shrinkJsonlTail` 不归一预算。** `NaN` 与 `+Infinity` 会整段关掉收缩；`0`、负数与 `-Infinity` 仍会收缩到最多两行。触发策略（包括"0 表示永不裁剪"）与错误处理都归调用方。
- **`jobOutcomeOf` 抄的是宿主 bash 工具的文案。** 测试检查的是 `exit code: N` / `signal: NAME` 这些字面量，不是与上游函数逐字相等——那个函数无法从已发布包里 import。上游哪天改措辞，本包不会报错，显示文本仍是本包自己的。
- **`editPathOf` 只认一种只读写法。** 只有 `str_replace_editor` 且 `command: "view"` 才是 `read-view`；其余带 `file_path` 的工具一律按 `write` 处理，不再做其他判断。
- **PTC 载荷来自官方包。** `lib/tool-events.ts` 从 `@deepseek-ai/dsh-tool-executor-ptc/types` re-export 两个载荷类型，`SessionEventMap` 增补也由官方包自带；本包不再声明自己的副本，也不再自己增补映射。`engines.dsh` 与每条 dsh peer 现在都收在单条 `^0.2.3-alpha.2` 上，窗口里只有这一代宿主，旧 rc 线「增补换过宿主包」的理由不再适用。`test/tool-events-ptc-keys.ts` 是编译期的探针：任一事件键从联合里消失或 re-export 断掉，`pnpm typecheck` 先于任何消费方红出来——运行期断言做不到，因为类型已被擦除。裸说明符会存活进发布出去的 `dist/types/tool-events.d.ts`，所以 shared 把该包声明为 **optional peer**：不碰 PTC 载荷的 `./tool` 消费方不会被安装器要求装它；真正引用 PTC 载荷类型或自建 PTC 事件的消费方（当前是 dsh-danger-guard、dsh-quality-gate），才需要在各自 `devDependencies` 里钉同一枚包。`skipLibCheck` 会把未解析的 import 静默吞掉，所以「tsc 绿」不等于解析到位。

## <img src="https://api.iconify.design/lucide/lock.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 数据与隐私

本包被 import 进宿主进程；下表描述的是运行期。

| 项目 | 内容 |
| --- | --- |
| 文件访问 | `deriveProjectKey` 只对你交给它的那条路径调用 `realpathSync`。失败（`ENOENT` / `EACCES`）退回 `path.resolve`，不外抛。运行期模块里没有别的文件访问；构建期辅助会读清单、写 `dist/` 与临时 tsc 目录 |
| 磁盘写入 | 运行期模块不写文件、不写缓存、不写日志。构建期辅助会写 `dist/` 与临时文件，它们不属于运行期面 |
| 环境变量 | 不读任何环境变量 |
| 网络 | 没有出站请求，没有 HTTP 服务，没有子进程 |
| 动态代码 | 没有 `eval`，没有 `new Function`，没有动态 `import()` |
| 进程内状态 | 唯一的跨实例可变状态是 `claimApply` 在 `globalThis` 上的标记，effect 卸载或标记失败时恢复；该标记属于一个 realm 的 `globalThis`，不是进程内所有线程共享 |
| 日志 | 运行期模块里只有 `lesson-bus` 的 `onFailure` 自己抛错时会 `console.error`；构建期辅助在 rolldown bundle 释放失败时也记一条（两条都登记在 `test/log-templates.ts`），测试 setup 会把每条 `[shared/*]` 日志与模板清单比对 |

## <img src="https://api.iconify.design/lucide/layers.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 版本与兼容

- **公共接口一律按语义化版本**：子路径、导出的值符号、导出的类型、错误/原因枚举。`0.x` 的区间只放行 patch 位，所以动这些就是消费方区间里的破坏性变更。
- **0.3.0 是破坏性版本，不是 patch。** 它删除了 `./tool/<module>` / `./lib/<module>` 运行期别名与 `./client-node`，九个消费仓同批迁到 `./tool` / `./client`。这次删除应按破坏性变更读：只有源码与构建都不再引用旧别名的消费方才能安全使用 `^0.3.0`，因此它按 0.3.0 记版本，不作为 patch 发布。此后的发布恢复上面的 patch 规则：patch 不得删除已导出的名字，破坏性改动走 0.4.0 并重发消费者。
- **`deriveProjectKey` 的哈希算法、8 位切片与尾段空白清洗是冻结的。** 改动任何一位都会让既有的教训与记忆数据在新键下找不到。
- **Windows 路径归一改变了键的形态。** 同一目录无论写成 `\` 还是 `/` 都得到 `尾目录名-<哈希>`，盘符根与 UNC 共享根归入 `default`。归一之前在 Windows 上生成的键不再匹配；POSIX 的键逐字节不变，并有字面量断言固定。
- **Windows 扩展路径的 0.1.7 回归已修。** `\\?\C:\repo`、`\\.\C:\repo`、`\\?\Volume{...}\repo` 不再被误判成 UNC 共享根；非根哈希输入保留 `realpath` 返回的拼写，因此保留前缀时回到 0.1.6 的字面键（测试钉住 `\\?\C:\repo` → `repo-e8b99b5c`），宿主剥掉前缀时则得到普通路径的键。`\\?\C:\` / `\\.\C:\` / `\\?\Volume{...}` 回到 `default`，不再造 `C:-...` / `Volume{...}-...` 假键。扩展写法与普通 `C:\repo` 不由本函数折叠；`realpath` 保留前缀时仍是两把键。前缀折叠属于独立的键格式迁移，需要旧键样本与对端规则。
- **`Locale` 是官方 `BuiltInLocaleId` 的别名**，因此跟着宿主的 `LOCALE_IDS` 走，不再是手写的字面量联合。
- **`errorText` 返回的是展示文本，不是可解析格式。** 它对齐官方 `errorChain` 的语义：cause 链拼成 `外: 内`、`AggregateError` 附 `[e1; e2]`、空 message 回退 `Error.name`、跨 realm 的 Error 取其自带 `message` 而不是 `String()` 的 `"Error: ..."`。拿它做正则匹配的调用方超出了受支持的用法。
- **`editPathOf` 返回按 `kind` 判别的 `EditTarget`，只有 `write` / `read-view` 两个分支。** `"skip"` 从来不会被产出，留在类型里只会迫使调用方写永不执行的分支。路径取不到时仍返回所属分支，`path` 为 `undefined`。
- **`./lib/http` 与 `./lib/trust` 已删除。** 插件家族的设置卡数据通道运行在官方 Typert Remote 上，认证、Host / DNS 重绑定 / Origin 校验与 body 上限由宿主的 `/api` 网关承担。还要自建 `webServer` 路由的插件得自己写这些检查——发布内容不再提供第二套"这个请求准不准"的答案。
- **声明文件对着一条宿主线编译，却装进一个 peer 窗口。** `devDependencies` 锁死构建与测试用的精确 `@deepseek-ai/*` 版本；`dsh` peer 家族与 `engines.dsh` 共用支持范围，窗口内的宿主无需第二份构建即可装载。窗口滚动意味着更新开发钉版、重跑对照断言并重新发布；把范围放宽到取证窗口之外不在支持范围内。

## <img src="https://api.iconify.design/lucide/circle-help.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 常见问题

| 问题 | 回答 |
| --- | --- |
| 要不要 `dsh plugin add` 它？ | 不要。它声明的是 `dsh.client`（消费者要启用的那一行），但没有 `dsh.bundle.patch`，单独添加不会装出配置层，也启用不了任何东西。正确做法是声明成插件包的依赖，再在自己的 `cordis.patch.yml` 里插入带固定 id 的 `- id: dsh-plugin-shared` 行，并保持这一行开启。 |
| 消费方启动时报 `does not provide an export named ...` 与 `N entries did not activate`。 | profile 提供的那份本包比消费方 import 的版本旧。把 profile 的 `overrides` 版本调高到包含该子路径的版本；对照本包的 `exports` 与 CHANGELOG。任何单仓 CI 都看不见这个状态。 |
| 改了 `lib/*.ts`，消费方还是旧行为。 | 消费方载入的是 `dist/`。先运行 `pnpm run build`；`test/build-host.test.ts` 会在运行期产物过期时判定失败。workspace link 不会绕过产物。 |
| 为什么 `@deepseek-ai/dsh-output-retention` 是必需 peer，其余都是 optional？ | 它是唯一**必需**且按值导入的宿主包（`truncateEnd`）。`@deepseek-ai/dsh-typert-protocol` 也按值导入，但只被 `./tool` 取用，所以仍是 optional；其余 dsh peer 只承载类型。裸 `@deepseek-ai/dsh` peer 只声明宿主版本线，`react` 则是 `./client` 的值导入 peer。 |
| 为什么 `oxlint` 不写成 `peerDependency`？ | npm 7+ 会去满足它，而 `oxlint` 的 optional `vite-plus` peer 把 `vitest` 锁定在基线所需范围之外，普通安装会得到 `ERESOLVE`。这条要求因此写在文档里。 |
| 想把某个 helper 收录进来？ | 先确认那份函数体在两个以上包里逐字重复。带领域判断的部分留在插件里。 |

## <img src="https://api.iconify.design/lucide/wrench.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 开发

```sh
pnpm install
pnpm run check   # typecheck → lint → build → test → 格式检查
pnpm test        # vitest，带覆盖率
pnpm run build   # 运行期产物、配置产物、声明文件、客户端行
```

- 测试按「stub 覆盖不到的那类缺陷」分层：
  - **模块行为**：每个运行期模块一份 `test/<模块>.test.ts`。
  - **接口一致性（surface parity）**：`test/index.test.ts`（barrel ↔ `lib/` 的值导出）、`test/publish-manifest.test.ts`（`exports` ↔ `lib/` 双向）与 `test/build-host.test.ts`（`build-host.mjs` 的 `facets` ↔ `lib/`）。三条检查各抓一种另外两条发现不了的漏项。`test/tool-events-ptc-keys.ts` 是声明侧的对应物：它断言两个 PTC 事件键仍在 `SessionEventMap` 联合里、re-export 仍解析到官方类型，且刻意没有运行期用例——类型断言在 vitest 看到它之前就已被擦除；判它的是 `pnpm typecheck`。
  - **产物检查**：`test/build-host.test.ts` 把磁盘上的运行期产物与内存构建逐字节比对，并固定官方值导入必须保持裸说明符、拒绝为 `dsh-jobs` / `dsh-shell` 留下运行期说明符；`test/dist-size.test.ts` 把运行期、客户端、配置与构建编排产物各自限制在字节预算内。
  - **配置检查**：`test/config-oxlint.test.ts` 把 vitest 规则快照与 `oxlint --rules` 的实际输出对照，并要求每条 `off` 都有依据；`test/vitest-base.test.ts` 固定合并行为，保证四项阈值与统计范围不会被局部改配抹掉，并固定客户端别名指向发布产物（不能是源码路径）、react 族只走 `dedupe` 不再有文件系统别名，并覆盖 `undefined` 继承、inline 只增不减、`test.coverage` 拒绝与 `coverageInclude` 零命中普查。
  - **日志记录**：`test/setup-logs.ts` 接管 `console.*`；每条 `[shared/*]` 日志都要匹配 `test/log-templates.ts` 里的模板片段，否则测试立即失败。`test/log-templates.test.ts` 双向校验，增删日志却不改记录清单都会失败。
  - **发布形态**：`test/publish-manifest.test.ts` 要求入口目标都在 `files` 覆盖内、入口指向产物而不是源码、`publishConfig` 不带入口字段、每条 peer 都在 `peerDependenciesMeta` 里明确标注、`dsh-*` 开发钉版精确且统一、dsh peer 范围与 `engines.dsh` 相同，并要求源码、文档与产物里没有日期、绝对路径、家目录指涉或只在协作当时成立的措辞。
- 覆盖率四项阈值都是 **100%**（lines / statements / functions / branches），所以新增分支必须有能走到它的用例。`test/vitest-base.test.ts` 拒绝空 `coverageInclude`，因为那会让四项阈值在空统计范围上全部通过。
- CI 在 Linux、Windows 与 macOS 上以 Node 24.22.3 运行同一组检查，并有一周一次的定时运行来发现上游变化。安装矩阵会分别用 npm 与 pnpm 打包，在干净目录里不带 peer 解析选项安装，逐子路径 import，并在两种 `skipLibCheck` 设置下对一小段消费方导入代码做类型检查。

## 反馈

欢迎提 issue 和 PR：[https://github.com/JayYuen666/dsh-plugin-shared/issues](https://github.com/JayYuen666/dsh-plugin-shared/issues)。

插件启动失败时，请附上 dsh 宿主版本、profile 安装形态和浏览器控制台原文。`missed the module table` 这一行尤其有用：它能直接说明 shared 客户端供应行有没有被物化。

## <img src="https://api.iconify.design/lucide/scale.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 许可

MIT。源码在 [github.com/JayYuen666/dsh-plugin-shared](https://github.com/JayYuen666/dsh-plugin-shared)。`LICENSE` 随包发布。
