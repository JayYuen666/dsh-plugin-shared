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
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-4c1?style=flat-square&logo=nodedotjs&logoColor=white" alt="node" />
  <img src="https://img.shields.io/badge/dsh-%5E0.2.1--rc.3-658EFF?style=flat-square" alt="dsh" />
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

- [它做什么](#它做什么)
- [安装](#安装)
- [确认它在正常工作](#确认它在正常工作)
- [它不提供什么](#它不提供什么)
- [模块清单](#模块清单)
- [config 导出](#config-导出)
- [已知边界](#已知边界)
- [数据与隐私](#数据与隐私)
- [版本与兼容](#版本与兼容)
- [常见问题](#常见问题)
- [开发](#开发)
- [许可](#许可)

## <img src="https://api.iconify.design/lucide/shield.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 它做什么

- **它是库，不是插件。** `package.json` 里没有 `dsh` 字段，包目录下也没有 `cordis.patch.yml`，所以位于 `node_modules` 的副本不会被宿主登记成插件。它没有设置卡，没有客户端部分，也没有自己的路由。
- **它收录的是各插件逐字重复的部分：**
  - 工具事件记录表（`./lib/tool-events`）：一次扫描把 `SessionEvent[]` 变成调用表与结果表，PTC 子调用一并合并；`editPathOf` 提取其中可见的编辑目标。
  - 客户端卡片基础组件（`./lib/card-apply`、`./lib/card-diff`）：跨 HMR 保证 apply 幂等的保护逻辑，以及把 `null`、`undefined` 与键缺失当成同一种值的表单差异比较。
  - 运行期工具（`./lib/project-key`、`./lib/locale`、`./lib/lesson-bus`、`./lib/text`、`./lib/record`、`./lib/errors`、`./lib/jsonl`、`./lib/job-outcome`）：各个插件原本都要重写一遍的小逻辑。
  - 构建期与检查基线（`./lib/canonicalize-region-paths`、`./config/*`）：产物路径规范化，加上给每个消费方的 oxlint、vitest 与 tsconfig 起点。
- **它只做通用处理，不做领域决策。** 哪些工具算编辑、路径怎么过滤、预算多大、检查何时该报错，都留在各插件。共享层对交给它的领域不做判断。

### 收录边界

- **逐字相同是收录标准。** 同一份函数体在两处以上出现才收录。看起来相似、但失败语义、缓存方式或覆盖方式不同的，留在原地。
- **领域判定留在外面。** 依赖某个插件自己的工具清单、策略或面向用户的措辞的谓词，不是样板，即使它出现了两次。
- **发布出去的接口就是承诺。** 新增模块要同时加子路径、barrel 再导出（构建期那一项除外）、构建脚本入口、构建 `include` 与用例；漏一处会被「开发」一节的一致性检查判定失败。

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 安装

```sh
npm install @jayyuen66/dsh-plugin-shared
# 或
pnpm add @jayyuen66/dsh-plugin-shared
```

把它声明成插件包的普通依赖，按裸包名子路径导入：

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/lib/record";
```

终端用户不需要单独安装或启用它：任一消费包安装时都会自动包含它。它缺失时的失败是 `ERR_MODULE_NOT_FOUND`（说明符指向 `@jayyuen66/dsh-plugin-shared/...`），不会静默变成其他行为。本包没有 default 导出；请从 barrel 或子路径使用具名导入。

| 要求 | 值 |
| --- | --- |
| Node.js | `>=22.12.0`——插件家族共用的发布侧下限，声明同一个 `engines.node` 的包不会因为这个库而被拒 |
| dsh | `^0.2.1-rc.2`，声明为 **optional** peer（import 本包不需要宿主存在） |
| 模块形态 | 仅 ESM。`require()` 只在支持 `require(esm)` 的 Node 上可用 |
| Tree shaking | `"sideEffects": false` |

### 依赖要求

`dependencies` 为空；所有 `@deepseek-ai/*` 只出现在 `peerDependencies` 与 `devDependencies` 里。`test/publish-manifest.test.ts` 固定了这条要求，理由是一次启动期故障，不是风格偏好：

- **宿主包写进 `dependencies` 会让消费方的宿主无法工作。** profile 用 `nodeLinker: hoisted` 与 `autoInstallPeers: false` 安装，于是列在 `dependencies` 里的宿主包会被安装成真实目录，与宿主进程已加载的那份并存。`@deepseek-ai/dsh-tools` 的工具运行期调度键是普通 `Symbol`（不是 `Symbol.for`），符号身份按模块实例计算：宿主从副本上读那个键得到 `undefined`，于是每一次原生工具调用都抛错。构建、类型检查与测试在此之前全部通过；这条不变式只能写在 manifest 上。
- **`@deepseek-ai/dsh-output-retention` 是唯一必需 peer。** 它是值导入（`truncateEnd`），运行期由宿主提供；在 `peerDependenciesMeta` 里明写成 `"optional": false`，不靠"没写就等于必需"，因为没写进那张表对 npm 7+ 就是硬要求。
- **其余 peer 都是 optional。** 除裸 `@deepseek-ai/dsh`（只声明宿主版本线）外，它们只承载类型声明。放在 `peerDependencies` 里让发布出去的 `.d.ts` 与实际依赖一致；`devDependencies` 让本仓能编译与测试。profile 不装 peer，所以不会产生副本。
- **版本要求跟着宿主走。** `dsh-*` 与 `cordis` 精确锁定在宿主声明的版本上，保证复用同一份。`test/publish-manifest.test.ts` 还要求每条 `dsh-*` 锁定版本与 `@deepseek-ai/dsh` peer 的版本一致。
- 已知上游限制：`@deepseek-ai/dsh-llm` 的声明文件引用了它自己没声明的 `@deepseek-ai/dsh-attachment`。它经 `dsh-session` 传递进来，所以开 `skipLibCheck: false` 的消费方会看到来自那个包的 `TS2307`，不是来自本包。

### shared 的版本下限

消费者的 profile 可以用 pnpm `overrides` 把本包固定在某个版本。固定得低于某个 `./lib/...` 子路径首次出现的版本，宿主启动时就会报 `N entries did not activate` 与 `does not provide an export named ...`：包装得上、永远不加载，而任何单仓 CI 都看不见。要固定版本请先对照本包的 `exports` 与 CHANGELOG。

### 随包发什么

- `main` 与 `exports` 只指 `dist/`，不存在第二套源码形态的 manifest。Node 对 `node_modules` 里的 `.ts` 直接抛 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，而发布出去的包正是在那里被载入的，所以产物是必需的。
- `files` 是 `icon.svg`、`dist`、`config/*.json` 与 `README.zh-CN.md`。npm 永远附带 `package.json`、`LICENSE` 与 `README.md`；中文版显式列出才会一起发。
- `publishConfig` 只带 `access` 与 `registry`。把入口字段放在那里容易出错：pnpm 发布时会把它合并到顶层，npm 不会——换一个发布器就会发出一个入口指向 tarball 里不存在文件的包。
- `build` 先删除 `dist/`，再产出运行期产物、配置产物、类型声明与生成的 barrel 声明。两个构建脚本都压缩；`test/dist-size.test.ts` 把运行期产物与配置产物各自限制在预算内。
- `prepare` 指向 `build`。消费方从 registry 安装时它不执行；它存在是为了让打包、发布与 workspace link 拿到的都是新鲜 `dist/`。
- 新增模块要同时改五处：`lib/index.ts` 的 barrel、`exports`、`build-host.mjs` 的 `facets` 数组、`tsconfig.build.json` 的 `include`，外加一份 `test/<模块>.test.ts`。漏一处会被「开发」一节的一致性检查判定失败。

## <img src="https://api.iconify.design/lucide/circle-check.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 确认它在正常工作

1. **子路径能解析。** 在消费包里运行 `node -e 'import("@jayyuen66/dsh-plugin-shared/lib/record").then((m) => console.log(typeof m.isRecord))'`，输出 `function`。`ERR_MODULE_NOT_FOUND` 表示依赖没装上；`does not provide an export named ...` 表示装到的那份比你 import 的子路径旧。
2. **barrel 能解析。** 换成裸包名做同一件事，应能取到运行期模块。`canonicalize-region-paths` 是唯一刻意不在 barrel 里的模块；构建脚本需要时按子路径取。
3. **消费方宿主能启动。** 启动声明该插件的 profile。若启动日志出现 `N entries did not activate` 与 `does not provide an export named ...`，说明 profile 的 `overrides` 固定得比包含该子路径的版本低——调高固定版本，不要改插件。
4. **本地源码改动能反映到消费方。** 消费方载入的是 `dist/`，不是 `lib/`。改完先运行 `pnpm run build`；`test/build-host.test.ts` 会把磁盘上的运行期产物与内存构建逐字节比对，产物过期即报错。"代码改了却没生效"多半是产物过期，不是缓存问题。

## <img src="https://api.iconify.design/lucide/circle-slash.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 它不提供什么

- **不注册插件。** 没有 `dsh` 字段，没有 `cordis.patch.yml`，`--dump-config` 里没有它这一层；`dsh plugin add` 是错误动作。
- **没有设置卡，也没有客户端部分。** 本包没有浏览器入口，也没有客户端状态。
- **没有 HTTP 路由，也没有请求信任检查。** 真正注册路由的插件由宿主的 `/api` 网关负责认证、Host / Origin 校验与 body 上限。
- **没有 CLI 子命令，也没有模型工具。**
- **不做领域判定。** 它不知道哪些工具算编辑、哪条路径是密钥、预算多大、检查何时该报错。这些属于调用方的插件。

## <img src="https://api.iconify.design/lucide/package.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 模块清单

「子路径」是包内说明符，值 import 要带裸包名前缀。`exports` 另含 `./package.json`，供宿主读展示元数据。

| 子路径 | 提供什么 |
| --- | --- |
| `.` | 下面列出的运行期模块的 barrel。`canonicalize-region-paths` 刻意不进，运行期消费方不必为它增加一次导入；客户端专用的 `card-ui` 同样不进，理由还多一条：根 barrel 不得把 `react` 带进每个消费方 |
| `./lib/tool-events` | `scanToolEvents` 返回 `calls` / `results` 两张表，PTC 子调用一并合并；`toolEventRowsOf` 处理单个事件，交回的记录已带归一后的 `arguments` 与 `badArguments`。`editPathOf` 返回按 `kind` 判别的 `EditTarget`，只有 `write` / `read-view` 两个分支；路径取不到时为 `undefined`。记录字段一律 `readonly`。同时再导出官方 `SessionEvent` 与两个 PTC 事件类型 |
| `./lib/card-apply` | `claimApply` + `CardApplyCtx`：保证 apply 幂等的保护逻辑，建立在 `globalThis` 上的**自有**标记（symbol，或外部写入的 `true`）加 `ctx.effect` 清理。标记是进程级的，所以同一页面的第二个 ctx 会被拒绝——这是有意的设计 |
| `./lib/card-diff` | `diffTouched`：touched 层里哪些字段真的与快照不同，按表单值比较。`undefined`、`null` 与键缺失是同一种值；数组与对象逐元素比较；循环引用也能正常结束 |
| `./lib/card-ui` | 客户端专用设置卡组件：`CardForm`、`Section`、`FieldGrid`、`StatusBar`、`Field`、`FieldLabel`、`InfoTip`、`ToggleField`、`NumberField`、`TextField`、`ListField`、`SelectField`、`SaveBar`、`splitHint` 与样式字符串 `CARD_UI_CSS`。只用 `createElement`；`react` 是 optional peer，该子路径永不进根 barrel。只用 React 18 运行时 API（`useId`、`useState`、`useEffect`、refs） |
| `./lib/project-key` | `deriveProjectKey` + `ProjectKeyOptions`：cwd → `尾目录名-<sha256(norm) 前 8 位 hex>`；非字符串、空串或归一后的根目录归入 `default`。`realpathSync` 会解析软链接，失败则退回解析后的路径。Windows 的 `\` 与 `/` 产生同一个键 |
| `./lib/locale` | `Locale`（官方 `BuiltInLocaleId` 的别名）、`DEFAULT_LOCALE`、`resolveLocale`、`resolveLocalePreference`、`messagesFor`、`MessagesCatalog`，加 `LOCALE_SETTINGS_NAMESPACE` 与 `LOCALE_PREFERENCE_FIELD`。只负责宿主侧字典；客户端用官方 locale 包 |
| `./lib/lesson-bus` | `settleLessonCall`：同步抛错与异步 rejection 归到同一个 `onFailure` 出口。函数型 thenable 也算可等待；`onFailure` 自己抛错或拒绝时被统一处理，不会分成"抛给调用方"或"未处理拒绝"两种结果 |
| `./lib/text` | `truncateEnd` 转交官方 `truncateWithoutSplittingSurrogatePair`；`truncateStart` 是官方导出内容里没有的后切形式。两者都按代理对安全切；预算不足一个码元（含 `<= 0` 与 NaN）返回空串 |
| `./lib/record` | `isRecord`、`fieldOf`、`hasMethods`。`fieldOf` 按设计走原型链（cordis 的服务方法定义在那里）；遇到恶意 getter 或 Proxy trap 时改返回 `undefined`，不抛错。`hasMethods` 要求指定的每个方法都可调用，并且不把 `Object.prototype` 的成员当成服务实现 |
| `./lib/errors` | `errorText` 对齐官方 `@deepseek-ai/dsh-llm` 的 `errorChain` 语义（cause 链、`AggregateError` 成员、空 message 回退 `name`、跨 realm 取 `message`、恶意 getter 改用占位文本），本地零依赖实现。`isSettingsConflict` 由 `code` / `name` 识别宿主的设置冲突特征，跨 realm 抛来的错误也能识别 |
| `./lib/jsonl` | `shrinkJsonlTail`：JSONL 尾部裁剪的纯逻辑模块。触发策略与错误处理留给调用方；字节预算是否有限由调用方保证 |
| `./lib/job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome` 把已结束的子进程映射成官方作业注册表的结局；`killProc` + `KillableProcess` 释放子进程句柄，对抛错或拒绝的 `kill()` 一律忽略（例如进程已被回收） |
| `./lib/canonicalize-region-paths` | 构建期字符串处理：把 rolldown 写下的 `//#region <路径>` 改写成与 `process.cwd()` 无关的形态。只提供子路径，是为了让构建脚本取得到它，同时不把运行期 barrel 增大 |

`card-ui` 是唯一刻意只走子路径的运行期模块：把它加进 barrel 会让每个 host 侧 importer 都去解析 `react`。

## <img src="https://api.iconify.design/lucide/sliders-horizontal.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> config 导出

这些是给插件作者用的 lint/test 基线，不是运行期代码。它们依赖你的包自己提供的工具链：

| 子路径 | 提供什么 | 你需要装什么 |
| --- | --- | --- |
| `./config/oxlint` | `definePluginConfig`、`makeTestFileOverrides`、`OFF_JUSTIFICATIONS` 与共享规则基线 | `oxlint`；要启用 sonarjs 规则还要 `eslint-plugin-sonarjs` |
| `./config/vitest.base` | `definePackageConfig`：四项 100% 覆盖率阈值、20 秒测试超时、共享覆盖率排除表与用例匹配范围 | `vitest` 与 `@vitest/coverage-v8`（基线把 `coverage.provider` 固定为 `"v8"`） |
| `./config/tsconfig.base.json`、`./config/tsconfig.client.base.json` | 给 `extends` 用的纯 JSON | 什么都不用 |

这些工具链包**不**写进 `peerDependencies`：npm 7+ 连 optional peer 都会去满足，而 `oxlint` 自己的 `peerOptional vite-plus` 把 `vitest` 锁定在一个与 `>=5.0.2` 无交集的版本上，结果是本包的普通 `npm install` 直接 `ERESOLVE` 失败。这条约束因此写在文档里，而不是 manifest 里。

- sonarjs 的入口在 `definePluginConfig()` 内部惰性解析。没装 sonarjs 时导入 `./config/oxlint` 仍然成功；既没装 sonarjs、`jsPlugins` 里也没带 sonarjs 入口时，调用 `definePluginConfig()` 才抛错，消息里写明试过哪两个说明符，以及自备入口的方法。
- 基线里每条关闭为 `off` 的规则都要在 `OFF_JUSTIFICATIONS` 里有 `kind` + `measured` + `note`，否则配置加载即抛。包级例外写进那个包自己的 `offReasons`。
- `definePackageConfig` 拒绝空 `coverageInclude`，也拒绝 `test.coverage` 块：两者任一都会让四项阈值或统计范围静默消失。要例外就在需要例外的包自己的 `coverage` 覆盖项旁边写明理由。

## <img src="https://api.iconify.design/lucide/triangle-alert.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 已知边界

按类登记，每类一条；每条都由测试按现状固定。

- **`fieldOf` 刻意走原型链。** 改成 `Object.hasOwn` 会让所有 cordis 服务方法都取不到。读用户设置值的代码必须改用自有属性判断；`resolveLocalePreference` 就是例子，两个方向都有用例覆盖。
- **`claimApply` 是进程级标记，不是 per-context 锁。** 同一页面上第二个 ctx 申请同一张卡会被拒绝。需要多 ctx 并存的消费方应自己按 ctx 管理，而不是"修"这道保护。
- **`shrinkJsonlTail` 不归一预算。** `NaN` 与 `+Infinity` 会整段关掉收缩；`0`、负数与 `-Infinity` 仍会收缩到最多两行。触发策略（包括"0 表示永不裁剪"）与错误处理都归调用方。
- **`jobOutcomeOf` 抄的是宿主 bash 工具的文案。** 测试检查的是 `exit code: N` / `signal: NAME` 这些字面量，不是与上游函数逐字相等——那个函数无法从已发布包里 import。上游哪天改措辞，本包不会报错，显示文本仍是本包自己的。
- **`editPathOf` 只认一种只读写法。** 只有 `str_replace_editor` 且 `command: "view"` 才是 `read-view`；其余带 `file_path` 的工具一律按 `write` 处理，不再做其他判断。

## <img src="https://api.iconify.design/lucide/lock.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 数据与隐私

本包被 import 进宿主进程；下表描述的是运行期。

| 项目 | 内容 |
| --- | --- |
| 文件访问 | `deriveProjectKey` 只对你交给它的那条路径调用 `realpathSync`。失败（`ENOENT` / `EACCES`）退回 `path.resolve`，不外抛。`lib/**` 里没有别的文件访问 |
| 磁盘写入 | 没有。本包不写文件、不写缓存、不写日志 |
| 环境变量 | 不读任何环境变量 |
| 网络 | 没有出站请求，没有 HTTP 服务，没有子进程 |
| 动态代码 | 没有 `eval`，没有 `new Function`，没有动态 `import()` |
| 进程内状态 | 唯一的跨实例可变状态是 `claimApply` 在 `globalThis` 上的标记，effect 卸载或标记失败时恢复 |
| 日志 | 只有 `lesson-bus` 里的 `onFailure` 自己抛错时才会 `console.error`；测试 setup 会把每条 `[shared/*]` 日志与模板清单比对 |

## <img src="https://api.iconify.design/lucide/layers.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 版本与兼容

- **公共接口一律按语义化版本**：子路径、导出的值符号、导出的类型、错误/原因枚举。`0.x` 的区间只放行 patch 位，所以动这些就是消费方区间里的破坏性变更。
- **`deriveProjectKey` 的哈希算法、8 位切片与尾段空白清洗是冻结的。** 改动任何一位都会让既有的教训与记忆数据在新键下找不到。
- **Windows 路径归一改变了键的形态。** 同一目录无论写成 `\` 还是 `/` 都得到 `尾目录名-<哈希>`，盘符根与 UNC 共享根归入 `default`。归一之前在 Windows 上生成的键不再匹配；POSIX 的键逐字节不变，并有字面量断言固定。
- **`Locale` 是官方 `BuiltInLocaleId` 的别名**，因此跟着宿主的 `LOCALE_IDS` 走，不再是手写的字面量联合。
- **`errorText` 返回的是展示文本，不是可解析格式。** 它对齐官方 `errorChain` 的语义：cause 链拼成 `外: 内`、`AggregateError` 附 `[e1; e2]`、空 message 回退 `Error.name`、跨 realm 的 Error 取其自带 `message` 而不是 `String()` 的 `"Error: ..."`。拿它做正则匹配的调用方超出了受支持的用法。
- **`editPathOf` 返回按 `kind` 判别的 `EditTarget`，只有 `write` / `read-view` 两个分支。** `"skip"` 从来不会被产出，留在类型里只会迫使调用方写永不执行的分支。路径取不到时仍返回所属分支，`path` 为 `undefined`。
- **`./lib/http` 与 `./lib/trust` 已删除。** 插件家族的设置卡数据通道运行在官方 Typert Remote 上，认证、Host / DNS 重绑定 / Origin 校验与 body 上限由宿主的 `/api` 网关承担。还要自建 `webServer` 路由的插件得自己写这些检查——发布内容不再提供第二套"这个请求准不准"的答案。
- **声明文件与宿主版本锁定是耦合的。** 升级宿主意味着同步更新本包里精确的 `@deepseek-ai/*` 版本并重新发布；放宽成范围会让消费方载入一份本包没有对着它构建过的类型声明。

## <img src="https://api.iconify.design/lucide/circle-help.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 常见问题

| 问题 | 回答 |
| --- | --- |
| 要不要 `dsh plugin add` 它？ | 不要。它没有配置层也没有客户端部分，启用不了任何东西。正确做法是声明成插件包的依赖。 |
| 消费方启动时报 `does not provide an export named ...` 与 `N entries did not activate`。 | profile 提供的那份本包比消费方 import 的版本旧。把 profile 的 `overrides` 版本调高到包含该子路径的版本；对照本包的 `exports` 与 CHANGELOG。任何单仓 CI 都看不见这个状态。 |
| 改了 `lib/*.ts`，消费方还是旧行为。 | 消费方载入的是 `dist/`。先运行 `pnpm run build`；`test/build-host.test.ts` 会在运行期产物过期时判定失败。workspace link 不会绕过产物。 |
| 为什么 `@deepseek-ai/dsh-output-retention` 是必需 peer，其余都是 optional？ | 它是唯一按值导入的宿主包（`truncateEnd`）。其余都是类型声明，唯一的例外是裸 `@deepseek-ai/dsh` peer——它只声明宿主版本线。 |
| 为什么 `oxlint` 不写成 `peerDependency`？ | npm 7+ 会去满足它，而 `oxlint` 的 optional `vite-plus` peer 把 `vitest` 锁定在基线所需范围之外，普通安装会得到 `ERESOLVE`。这条要求因此写在文档里。 |
| 想把某个 helper 收录进来？ | 先确认那份函数体在两个以上包里逐字重复。带领域判断的部分留在插件里。 |

## <img src="https://api.iconify.design/lucide/wrench.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 开发

```sh
pnpm install
pnpm run check   # typecheck → lint → build → test → 格式检查
pnpm test        # vitest，带覆盖率
pnpm run build   # 运行期产物、配置产物、声明文件
```

- 测试按「stub 覆盖不到的那类缺陷」分层：
  - **模块行为**：每个运行期模块一份 `test/<模块>.test.ts`。
  - **接口一致性（surface parity）**：`test/index.test.ts`（barrel ↔ `lib/` 的值导出）、`test/publish-manifest.test.ts`（`exports` ↔ `lib/` 双向）与 `test/build-host.test.ts`（`build-host.mjs` 的 `facets` ↔ `lib/`）。三条检查各抓一种另外两条发现不了的漏项。
  - **产物检查**：`test/build-host.test.ts` 把磁盘上的运行期产物与内存构建逐字节比对；`test/dist-size.test.ts` 把运行期产物与配置产物各自限制在字节预算内；同一份测试还固定官方值导入必须保持裸说明符，并拒绝为 `dsh-jobs` / `dsh-shell` 留下运行期说明符。
  - **配置检查**：`test/config-oxlint.test.ts` 把 vitest 规则快照与 `oxlint --rules` 的实际输出对照，并要求每条 `off` 都有依据；`test/vitest-base.test.ts` 固定合并行为，保证四项阈值与统计范围不会被局部改配抹掉。
  - **日志记录**：`test/setup-logs.ts` 接管 `console.*`；每条 `[shared/*]` 日志都要匹配 `test/log-templates.ts` 里的模板片段，否则测试立即失败。`test/log-templates.test.ts` 双向校验，增删日志却不改记录清单都会失败。
  - **发布形态**：`test/publish-manifest.test.ts` 要求入口目标都在 `files` 覆盖内、入口指向产物而不是源码、`publishConfig` 不带入口字段、每条 peer 都在 `peerDependenciesMeta` 里明确标注、`dsh-*` 版本精确且统一，并要求源码、文档与产物里没有日期、绝对路径、家目录指涉或只在协作当时成立的措辞。
- 覆盖率四项阈值都是 **100%**（lines / statements / functions / branches），所以新增分支必须有能走到它的用例。`test/vitest-base.test.ts` 拒绝空 `coverageInclude`，因为那会让四项阈值在空统计范围上全部通过。
- CI 在 Linux、Windows 与 macOS 上运行同一组检查，Node 版本矩阵覆盖 22 与 24，并有一周一次的定时运行来发现上游变化。安装矩阵会分别用 npm 与 pnpm 打包，在干净目录里不带 peer 解析选项安装，逐子路径 import，并在两种 `skipLibCheck` 设置下对一小段消费方导入代码做类型检查。

## <img src="https://api.iconify.design/lucide/scale.svg?color=%23658EFF&height=22" height="22" width="22" align="absmiddle" alt="" /> 许可

MIT。源码在 [github.com/JayYuen666/dsh-plugin-shared](https://github.com/JayYuen666/dsh-plugin-shared)。`LICENSE` 随包发布。
