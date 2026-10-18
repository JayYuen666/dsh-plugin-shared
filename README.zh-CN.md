# @jayyuen66/dsh-plugin-shared

[English](./README.md) · [简体中文](./README.zh-CN.md)

## 这个包是什么

同组 dsh 插件共用的**依赖库包**：只被 `import`，不由用户启用。

- `package.json` 里没有 `dsh` 字段，包目录下也没有 `cordis.patch.yml`，所以它躺在 `node_modules` 里不会被宿主登记成插件。
- 没有设置卡、没有 client 半、没有自己的 `/_dsh` 路由。
- 收录判据：同一份样板在两处以上**逐字同构**地重复才收敛进来。领域判定（哪些工具算编辑、路径过滤、预算、门禁逻辑）留在各插件——共享层只标记，不决策。

## 安装

发布在公共 npm，安装侧不需要任何凭据。

```sh
npm install @jayyuen66/dsh-plugin-shared
# 或
pnpm add @jayyuen66/dsh-plugin-shared
```

把它声明成插件包的普通依赖，按裸包名子路径导入：

```ts
import { isRecord, fieldOf } from "@jayyuen66/dsh-plugin-shared/lib/record";
```

终端用户不需要单独安装或启用它：任一消费包都会顺带把它带进去。它缺位时的失败是 `ERR_MODULE_NOT_FOUND`（说明符指向 `@jayyuen66/dsh-plugin-shared/...`），不会静默降级。

## 前置要求

| | |
| --- | --- |
| Node.js | `>=22.12.0`——九仓发布侧共用的地板，声明同一枚 `engines.node` 的插件不会因为这个库而被拒 |
| dsh | `^0.2.1-rc.2`，声明为 **optional** peer（本包 import 时不需要宿主在场） |
| 模块形态 | 仅 ESM。`require()` 只在支持 `require(esm)` 的 Node 上可用 |
| Tree shaking | `"sideEffects": false` |

### 运行期会碰什么

| 行为 | 位置 | 范围 |
| --- | --- | --- |
| 经 `realpathSync` 读一个目录项 | `lib/project-key.ts` | 只读传给 `deriveProjectKey` 的那条路径；失败（ENOENT/EACCES）退回 `path.resolve` 的结果，不外抛 |
| 其余一概不碰 | — | `lib/**` 里没有别的文件访问、没有任何写入、不读环境变量、不发外部请求、没有 `eval`/`new Function`/动态 import |

`lib/card-apply.ts` 按设计读写 `globalThis` 上的一枚键——这正是它能在 HMR 造成模块实例重复时仍然生效的原因。

## 模块清单

「子路径」是包内说明符，值 import 要带裸包名前缀。`exports` 另含 `./package.json`，供宿主读展示元数据。

| 子路径 | 提供什么 |
| --- | --- |
| `.` | 下面列出的运行期切面的 barrel。`canonicalize-region-paths` 刻意不进，运行期消费方不必为它付一次导入 |
| `./lib/tool-events` | `scanToolEvents` → `calls`/`results` 两张表、`toolEventRowsOf`（它的单事件那一步，同一份实现）、`parseToolArguments` 与 `toolArgumentsBad`（自建折叠单元的消费方靠这一对，不必自己再读一遍 arguments 字段）、`editPathOf` 与 `EditTarget`（按 `kind` 判别，`write`/`read-view` 两支；路径取不到时 `path` 为 `undefined`）；台账三个接口字段一律 `readonly`；并转出官方 `SessionEvent` 与两枚 PTC 事件类型 |
| `./lib/card-apply` | `claimApply` + `CardApplyCtx`：apply 幂等守卫（`globalThis` 标记 + `ctx.effect` 卸载清理） |
| `./lib/card-diff` | `diffTouched`：草稿层里哪些字段真的与快照不同（按值比较，所以 `undefined`、`null` 与键缺失是同一种值） |
| `./lib/project-key` | `deriveProjectKey` + `ProjectKeyOptions`：cwd → `尾目录名-<sha256(norm) 前 8 位 hex>`，兜底桶 `default` |
| `./lib/locale` | `Locale`（官方 `BuiltInLocaleId` 的别名）、`DEFAULT_LOCALE`、`resolveLocale`、`resolveLocalePreference`、`messagesFor`、`MessagesCatalog`，加 `LOCALE_SETTINGS_NAMESPACE` 与 `LOCALE_PREFERENCE_FIELD` |
| `./lib/lesson-bus` | `settleLessonCall`：同步抛错与异步 rejection 归到同一个 `onFailure` 出口；函数型 thenable 也算可等待（漏判会留下未处理拒绝）；`onFailure` 自己抛错时被统一收口，不会分叉成"抛给调用方"或"未处理拒绝" |
| `./lib/text` | `truncateEnd`（转交官方 `truncateWithoutSplittingSurrogatePair`）与 `truncateStart`（后切；官方导出面没有后切形态） |
| `./lib/record` | `isRecord`、`fieldOf`、`hasMethods`（服务面校验：值必须是 Record，**且**点名的每个方法都可调用） |
| `./lib/errors` | `errorText`：语义对齐官方 `@deepseek-ai/dsh-llm` 的 `errorChain`（cause 链、`AggregateError` 成员、空 message 回退 name、跨 realm 取自有 message、敌意 getter 降级），本地零依赖实现；`isSettingsConflict` 由 `code` / `name` 认出宿主的设置冲突形状，跨 realm 抛来的错误也认得 |
| `./lib/jsonl` | `shrinkJsonlTail`：JSONL 尾部收缩的纯决策件；触发策略与错误出口留给调用方 |
| `./lib/job-outcome` | `jobOutcomeOf` + `SettledProcess` + `JobOutcome`：把落定的子进程映射成官方作业注册表的结局；`killProc` + `KillableProcess`：收掉子进程句柄，对已回收进程抛出的 `kill()` 忽略 |
| `./lib/canonicalize-region-paths` | 构建期字符串件：把 rolldown 写的 `//#region <路径>` 折成与 `process.cwd()` 无关的形态。之所以只给子路径，就是为了让运行期消费方不必为它付一次导入 |

## `config/` 面

这些是给插件作者用的 lint/test 基线，不是运行期代码，它们要吃你本包自备的工具链：

| 子路径 | 需要装什么 |
| --- | --- |
| `./config/oxlint` | `oxlint`；要挂 sonarjs 规则面还要 `eslint-plugin-sonarjs` |
| `./config/vitest.base` | `vitest`，以及 `@vitest/coverage-v8`（基线把 `coverage.provider` 钉成 `"v8"`） |
| `./config/tsconfig.base.json`、`./config/tsconfig.client.base.json` | 什么都不用——给 `extends` 用的纯 JSON |

这三枚工具链**不**写进 `peerDependencies`。npm 7+ 连 optional peer 都会去满足，而 `oxlint` 自己的 `peerOptional vite-plus` 把 `vitest` 钉在一个与 `>=5.0.2` 无交集的版本上，结果是本包的普通 `npm install` 直接 `ERESOLVE` 失败。这条约束因此写在文档里，而不是 manifest 里。

sonarjs 的入口是**惰性解析**的，发生在 `definePluginConfig()` 内部。没装 sonarjs 时导入 `./config/oxlint` 仍然成功；调用 `definePluginConfig()` 才抛错，消息里点名试过哪两个说明符，以及 `jsPlugins` 那条自备入口的出路。

`definePackageConfig` 会把四项覆盖率阈值钉在 100%、testTimeout 钉在 20 秒。它不会替你放宽：要例外就该在需要例外的包里写明理由。

## 依赖

`dependencies` 是空的；所有 `@deepseek-ai/*` 只出现在 `peerDependencies` 与 `devDependencies` 里。这条由 `test/publish-manifest.test.ts` 钉住，不是风格偏好：

- **写进 `dependencies` 会让消费方的宿主瘫掉。** 消费方是 dsh 插件，被装进 profile（`nodeLinker: hoisted`、`autoInstallPeers: false`）。宿主包只要出现在 `dependencies`，pnpm 就在 profile 里把它们落成**真实目录**，与宿主进程里已有的那份并存。而 `@deepseek-ai/dsh-tools` 的 `TOOL_RUNTIME_SCHEDULER` 是普通 `Symbol`（不是 `Symbol.for`），符号身份按模块实例计算——宿主 `dsh-agent-loop` 拿自己那份的 Symbol 去读由副本挂载出来的 `ToolRuntime`，得到 `undefined`，于是**每一次原生工具调用都抛** `Cannot read properties of undefined (reading 'prepare')`，整个 profile 的工具一起失效。本包的构建、类型检查与测试在这之前全部照绿，所以判据只能落在 manifest 面。
- `@deepseek-ai/dsh-output-retention` 是**值导入**（`truncateEnd` 用它），运行期由宿主提供，因此是唯一那条必需 peer——它在 `peerDependenciesMeta` 里明写成 `"optional": false`，不靠"没写就等于必需"，因为没写对 npm 7+ 是 `ERESOLVE` 硬失败，不是一条警告。
- 其余那些只被发布出去的 `.d.ts` 引用，声明成 optional peer 加 dev：peer 保住类型面不静默降级——`lib/job-outcome` 的 `ShellProcess`/`JobOutcome` 曾经来自消费方根本不保证存在的包，于是在 `skipLibCheck: true` 下写错 `status` 或 `exitCode` 一条都不报，返回值类型直接塌成 `any`；dev 让本包自己的编译与测试解析得到。profile 不装 peer，所以不产生副本。
- 版本口径跟着宿主走：`dsh-*` 家族内一律精确钉，`cordis` 也精确钉，与宿主本体自己声明的一致，这样是复用同一份而不是装出第二份。

已知的上游限制：`@deepseek-ai/dsh-llm` 的声明文件引用了它自己没声明的 `@deepseek-ai/dsh-attachment`。它经 `dsh-session` 传递进来，所以开 `skipLibCheck: false` 的消费方会看到来自**那个包**的 `TS2307`，不是来自本包。

## 发布形态

`main` 与 `exports` 只指 `dist/`，不存在第二套源码形态的 manifest。

- `publishConfig` 只带 `access` 和 `registry`。把 `main`/`exports` 放在那里是错的：pnpm 发布时会把它们合并到顶层，npm 不会——用 npm 发出去的包，十四个入口指向的都是 tarball 里不存在的文件。
- `files` 是 `icon.svg`、`dist`、`config/*.json`、`README.zh-CN.md`。npm 永远附带 `package.json`、`LICENSE` 和 `README.md`；`README.zh-CN.md` 显式列出才会一起发。
- `build` 第一步删除 `dist/`：`files` 整目录收，切面一旦改名，上一代孤儿产物会继续被发出去。
- `prepare` 挂 `build`。消费方从 registry 安装时它不执行；它存在是为了让打包、发布与 workspace link 拿到的都是新鲜 `dist/`。
- 必须有编译产物：Node 对 `node_modules` 里的 `.ts` 直接抛 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，而发出去的包正是躺在那里被载入的。barrel 的声明文件由 `build-host.mjs` 生成，因为源码形态的 `export * from "./record.ts"` 消费方解析不到。
- 新增切面要同时改三处：`exports`、`build-host.mjs` 的 `facets` 数组、`tsconfig.build.json` 的 `include`，外加 `test/<模块>.test.ts`。

## 版本与兼容

- 公共面一律按语义化版本：子路径、导出的值符号、导出的类型、错误/原因枚举。`0.x` 的区间只放行 patch 位，所以动这些就是消费方区间里的破坏性变更。
- `deriveProjectKey` 的哈希算法、8 位切片与尾段空白清洗是不可动的一面——动一位等于把存量教训与记忆从原桶里搬走。
- Windows 路径归一改变了桶键形态。Windows 上同一目录无论写成 `\` 还是 `/` 都落到同一个 `尾目录名-<哈希>` 桶，盘符根进 `default`。**归一之前写在 Windows 上的桶键不再匹配**；POSIX 的桶键逐字节不变，并由 `test/project-key.test.ts` 以字面量钉住。
- `Locale` 现在是官方 `BuiltInLocaleId` 的别名，不再是手写的字面量联合，因此跟着宿主的 `LOCALE_IDS` 走。
- **`errorText` 的返回值变长了**（签名与名字不变）。它从"单层 message"扩成与官方 `errorChain` 同语义：cause 链拼成 `外: 内`、`AggregateError` 附 `[e1; e2]`、空 message 回退 `Error.name`、跨 realm 的 Error 取其自带 `message` 而不是 `String()` 的 `"Error: …"`。**依赖旧文本做正则匹配的调用方要重新核对**（例如按括号取数的那类 `exec`）。
- `editPathOf` 的返回类型收成按 `kind` 判别的 `EditTarget`，只保留 `write` / `read-view` 两支——`"skip"` 从来不会被产出，留在类型里只会逼调用方写永不执行的分支。路径取不到时仍返回所属那一支、`path` 为 `undefined`。
- **`./lib/http` 与 `./lib/trust` 已删除。** 插件家族的设置卡数据面改跑官方 Typert Remote，认证、Host / DNS 重绑定 / Origin 判据与 body 上限由宿主的 `/api` 网关承担；那两条切面留着的是一份手写的、与宿主不同口径的"这个请求准不准"。没有任何消费包再 import 它们。还要自建 `webServer` 路由的插件得自己写闸门——这是刻意的：发布面不再提供第二套答案。

## 质量门

- `npm run check` = typecheck → lint → build → test（覆盖率 lines/statements/functions/branches 四阈值 100）→ fmt:check。
- `test/publish-manifest.test.ts` 是发布形态门：`exports` 的每个目标都必须在 `files` 真会发出去的范围内；入口必须指编译产物而不是源码；`publishConfig` 不得携带入口字段。它还钉着**切面与 `exports` 的双向 parity**：每个 `lib/*.ts` 都要有对应子路径（少一条 = 该切面对任何消费包都不可 import，而构建走的是 builder 自己的 entries 数组、不会报错），反过来也不许留悬空子路径。它还钉 **peer 的 optional 表态**：每一条 `peerDependencies` 都必须在 `peerDependenciesMeta` 里出现——没写进那张表的 peer 对 npm 7+ 的消费方就是硬要求，而类型检查、构建、用例与 parity 在那种状态下全部照绿。`./lib/canonicalize-region-paths` 正是"在 `exports` 里、不在 barrel 里"的那一枚，且这条子路径是承重的（除 Python 桥接包以外，各兄弟包的 rolldown `build-*.mjs` 都靠它），删它会一次性打断它们的构建。同一组"内部指涉"判据扫两个平面：**产物**不得出现绝对路径、家目录指涉、日期或兄弟包标识符；**源码与文档**不得出现日期与"这一轮/下一轮"这类只在协作当时成立的措辞——产物面那条看不见注释，所以必须单独扫源码，否则清理只是一次性动作、没有回归保护。
- `test/build-host.test.ts` 里的指纹用例比较磁盘产物与内存构建的字节，所以改了 `lib/*.ts` 忘了重建会直接红。
- `test/setup-logs.ts`（vitest setupFile）是算子日志的账本：它接管 `console.*`，于是 `lib/` 里留下的 `console.error` 既不会漏进测试报告（那条栈是纯噪点），又必须被用例认领——每条 `[shared/*]` 日志都要对得上 `test/log-templates.ts` 里的模板片段，否则当场红。别拿 vitest 的 `silent` 顶替：那只是不显示，新飘出来的日志照样没人看。
- `.github/workflows/ci.yml` 在 push 与 PR 上跨 Node 版本矩阵、并在 Windows 上跑同一道门；那边的安装矩阵还会打包、在干净目录里不带任何 flag 安装、逐子路径 import、并对消费方探针文件做类型检查。

## 常见问题

- **要不要 `dsh plugin add` 它？** 不要。它没有配置层也没有 client 半，启用不了任何东西；正确姿势是声明成依赖。
- **发布时 `401`/`403`** 多半是 npm token 没有发布权限；`404` 才是包/版本还不存在。
- **改了本包却「没生效」**：经 workspace link 本地开发时消费方载入的是 `dist/`，所以先重跑 `npm run build`；产物过期正是那道指纹门拦的事。
- **想收新代码进来**：先确认重复是**逐字同构**的。带领域判定的部分不收。

## 许可

MIT。`LICENSE` 随包发布。
