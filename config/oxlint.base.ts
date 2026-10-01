import { createRequire } from "node:module";
import { defineConfig } from "oxlint";
import type { OxlintConfig, OxlintOverride } from "oxlint";

export type RuleTable = NonNullable<OxlintConfig["rules"]>;

/**
 * 一条规则能被关掉的**全部**合法理由。写不进这六类的，就不该有关掉它的选项。
 * 每类的判据来自 oxlint/eslint 官方文档、上游 recommended 集合的归属，加上本仓的实测。
 */
export type OffReason =
  /** 规则的判据与官方契约方向相反，开了等于判官方写法违规。 */
  | "契约冲突"
  /** 与本仓已启用的对侧规则互斥（开一侧就判另一侧死刑）。 */
  | "对侧互斥"
  /** 按它的意思改代码会把代码改坏，有实测的编译/运行后果。 */
  | "实测否证"
  /** 判据只在某种文体（用例文件 / 构建脚本）里成立，按文件种类收窄。 */
  | "文体作用域"
  /** 纯口味规则，上游不放进 recommended，开启只带来语义无关的重写。 */
  | "上游不推荐"
  /** 旧 `.oxlintrc.json` 继承下来、实测开了是 0 条 —— 没有存在的理由，直接作废。 */
  | "零代价作废";

export interface OffJustification {
  /** 关它的理由类别。 */
  kind: OffReason;
  /** 打开它在全仓产生的条数（口径见 OFF_JUSTIFICATIONS 的头注释）。 */
  measured: number;
  /** 一句话依据；配置加载只要求这个字段非空。 */
  note: string;
}

/** `no-unsafe-call` / `-assignment` / `-return` / `-argument` 四条的依据与 member-access 同一条。 */
const NOTE_UNSAFE_SAME_AS_MEMBER_ACCESS = "同 no-unsafe-member-access";

/**
 * 实测口径：临时把基线里每条 `off`（rules 与 override 层都算）翻成 `error` 再跑 15 个成员、
 * 与基线取差数 `::error` 行，按路径分成 prod / test / scripts 三桶。`--deny=<rule>` 盖不住
 * `off`，最早一轮用它在 13 个包目录上量出的数因此全偏小（`vitest/no-hooks` 用 `-D` 量出来是
 * 0，实际是 181），整批作废重测。
 *
 * 键支持插件级通配（`vitest/*`），作用于该插件下没有更具体键的全部规则。
 */
export const OFF_JUSTIFICATIONS: Record<string, OffJustification> = {
  // ===== 文体作用域：vitest 的用例结构类判据只对 `*.test.ts` 成立 =====
  // oxlint 的 `plugins` 与 `categories` 都是全局作用域，没有 per-files 的插件开关，所以
  // 「只在测试文件里生效」只能这样实现：基线整族 off，再由 TEST_FILE_OVERRIDES 在用例文件上 on。
  // 抄的是 eslint-plugin-vitest 官方 recommended 的 files 作用域，规则一条不丢。
  // 实测挂在生产文件上的错用形态：danger-guard/host.ts 的模块级 `let strArrayWarned = false`
  // 被 require-hook 判成「setup 没进 hook」（3 条）、注释里出现官方设置 API 名 `describe()`
  // 被 no-commented-out-tests 判成「注释掉了用例」（3 条）、
  // dir-prep-organize/src/client-entry.ts:437 同类 1 条。
  "vitest/*": { kind: "文体作用域", measured: 7, note: "用例结构类判据在非用例文件上无从计算" },
  "vitest/no-hooks": {
    kind: "上游不推荐",
    measured: 181,
    note: "禁用 hook 本身；本仓按官方 vitest 用法大量使用 before*/after*",
  },
  "vitest/no-conditional-in-test": {
    kind: "文体作用域",
    measured: 523,
    note: "平台/宿主版本分支是刻意的（macOS 与 Linux 的家目录形状、0.1.7 与 0.1.6 的 API 面）",
  },
  "vitest/max-expects": {
    kind: "上游不推荐",
    measured: 163,
    note: "给单条用例的断言条数设上限属口味，不指向缺陷",
  },
  "vitest/prefer-expect-assertions": {
    kind: "上游不推荐",
    measured: 2902,
    note: "要求每个 async 用例手写 expect.assertions(n)，是与断言强度无关的计数仪式",
  },
  "vitest/require-test-timeout": {
    kind: "上游不推荐",
    measured: 2892,
    note: "要求每条用例显式 timeout；本仓用泵式假时钟，超时由 13 份 vitest 配置统一给",
  },
  "vitest/prefer-importing-vitest-globals": {
    kind: "实测否证",
    measured: 0,
    note: "autofix 方向是删掉显式 import 改回裸全局；13 份 vitest 配置都没开 globals:true，应用后当场 3605 处 TS2593、测试全废",
  },
  "vitest/no-importing-vitest-globals": {
    kind: "实测否证",
    measured: 133,
    note: "与上一条同族、方向相反，两条同时开就是把两种写法都判死",
  },
  "vitest/prefer-import-in-mock": {
    kind: "实测否证",
    measured: 6,
    note: "动态形态按完整模块面校验工厂返回值，而 @types/node 的 os、@types/react 都是 `export =` 形状、类型面上没有 default；实测三处 TS2769+TS2740/2741，react 那处无论怎么 spread 都补不出 default",
  },
  "vitest/prefer-lowercase-title": {
    kind: "上游不推荐",
    measured: 171,
    note: "只在用例文件里生效：它带 autofix，实测一轮 oxlint --fix 静默小写化了 260 条标题（含 nO_VERIFY 这种坏名）。包级 titlePrefixes 按 owner 2026-09-28 的口径只留真正的技术名（GET/CSRF/组件名…）：规格 ticket 号已从标题里删掉，中文开头的标题天然满足判据（无大小写）⇒ 免检面能收多小收多小。实测 oxlint 前缀一命中就把整条标题免检，所以陈旧条目由 scripts/assert-config-baseline.mjs 的 LINT_TITLE_PREFIX_UNUSED 点名，不靠人工巡检",
  },
  "vitest/prefer-called-times": {
    kind: "对侧互斥",
    measured: 0,
    note: "探针实测（同文件四种写法各跑一次）：toHaveBeenCalledTimes(1) 被 prefer-called-once 判死、toHaveBeenCalledOnce() 被本条判死、expect(spy.mock.calls).toHaveLength(1) 被 prefer-to-have-been-called-times 判死，只有 n>=2 能同时满足三条 ⇒ 三条同开等于「单次调用」这条断言无法书写（实测逼得 plugin-hot-reload 改用 assert.equal(spy.mock.calls.length, 1) 绕行）。留 prefer-called-once 与 prefer-to-have-been-called-times 两条方向一致的组合，关本条",
  },
  "vitest/prefer-describe-function-title": {
    kind: "对侧互斥",
    measured: 48,
    note: "要求 `describe(fn)`，而 valid-title 要求字符串字面量（oxlint 1.85 的 valid-title 是 DummyRule、无任何选项）；上游 recommended 收的是 valid-title，取它，26 处 `describe(fn)` 按代码改成同名字符串",
  },
  "vitest/prefer-to-be-truthy": {
    kind: "实测否证",
    measured: 117,
    note: "把 toStrictEqual(true) 放宽成 toTruthy()，接受任意真值是削弱断言",
  },
  "vitest/prefer-to-be-falsy": {
    kind: "实测否证",
    measured: 89,
    note: "同族，放宽成 toFalsy() 同样是削弱断言",
  },

  // ===== 契约冲突：官方插件/入口形态本身 =====
  "import/no-default-export": {
    kind: "契约冲突",
    measured: 38,
    note: "官方 cordis 入口就是 default export（vendor/loader/src/index.ts:201 先 unwrap default），12 条正是 12 个 bundle 入口",
  },
  "import/no-named-export": {
    kind: "契约冲突",
    measured: 895,
    note: "13 个包与上游 deepseek-harness 一样以具名导出 + 子路径说明符对外暴露",
  },
  "import/prefer-default-export": {
    kind: "契约冲突",
    measured: 58,
    note: "与 no-default-export 同族、方向与 cordis 入口相反",
  },
  "import/no-nodejs-modules": {
    kind: "契约冲突",
    measured: 448,
    note: "host 半就跑在 node 上，`node:` 内置模块是运行环境本身而不是越界",
  },
  "import/no-named-as-default-member": {
    kind: "契约冲突",
    measured: 47,
    note: "对具名导出的默认对象做成员访问是本仓消费官方声明的常态",
  },
  "import/no-anonymous-default-export": {
    kind: "契约冲突",
    measured: 12,
    note: "官方 cordis 入口是匿名对象 default export（registry.ts:92 读 name/Config/apply），具名化等于改官方形态",
  },
  "eslint/no-duplicate-imports": {
    kind: "实测否证",
    measured: 166,
    note: "ESLint 官方已废弃（不区分 import type），由 import/no-duplicates 取代",
  },

  // ===== 上游不推荐：纯口味，开启只带来语义无关的重写 =====
  "import/group-exports": {
    kind: "上游不推荐",
    measured: 766,
    note: "要求单点导出，与具名导出面冲突",
  },
  "import/exports-last": { kind: "上游不推荐", measured: 528, note: "要求导出语句在文件末尾" },
  "import/no-relative-parent-imports": {
    kind: "上游不推荐",
    measured: 277,
    note: "包内 lib/ 与 test/ 的相对父级引用是既有结构",
  },
  "import/max-dependencies": {
    kind: "上游不推荐",
    measured: 25,
    note: "给 import 条数设上限；host 半消费官方服务面天然依赖多",
  },
  "node/no-process-env": {
    kind: "上游不推荐",
    measured: 51,
    note: "环境变量是本仓的输入面（DSH_HOME、profile 目录、构建期开关）；eslint-plugin-n 的 recommended 也不含本条",
  },
  "eslint/no-magic-numbers": {
    kind: "上游不推荐",
    measured: 5774,
    note: "把 HTTP 状态码/毫秒阈值抽成常量的计数规则",
  },
  "eslint/sort-keys": {
    kind: "上游不推荐",
    measured: 4101,
    note: "对象键排序；成对字面量与 locale 字典的可读性会一起牺牲",
  },
  "eslint/sort-imports": {
    kind: "上游不推荐",
    measured: 675,
    note: "字母序 import，与 oxfmt 的分组形态冲突",
  },
  "eslint/capitalized-comments": {
    kind: "上游不推荐",
    measured: 2388,
    note: "本仓注释以中文为主，「首字母大写」对中文注释无从判定",
  },
  "eslint/no-ternary": {
    kind: "上游不推荐",
    measured: 1024,
    note: "禁三元；改写成 if/else 并不会更正确",
  },
  "eslint/no-undefined": {
    kind: "上游不推荐",
    measured: 2009,
    note: "禁 `undefined` 字面量，与本仓大量显式可选返回形态冲突",
  },
  "eslint/no-void": {
    kind: "上游不推荐",
    measured: 172,
    note: "禁 `void` 前缀，而 `void promise` 正是消解 no-floating-promises 的官方写法",
  },
  "unicorn/no-null": {
    kind: "上游不推荐",
    measured: 788,
    note: "禁 null；官方声明与 JSON 边界大量用 null，改成 undefined 会改变序列化形状",
  },
  "typescript/prefer-readonly-parameter-types": {
    kind: "上游不推荐",
    measured: 2433,
    note: "要求每个入参类型全 readonly；官方声明面（SessionEvent/ConfigForm 等）是可变的，改不动也不该改",
  },

  // ===== 对侧互斥：与本仓已启用的现代语法侧规则直接相反 =====
  "oxc/no-async-await": {
    kind: "对侧互斥",
    measured: 2160,
    note: "禁 async/await，而同表里 promise-function-async、require-await、no-floating-promises 都在推 async",
  },
  "oxc/no-optional-chaining": {
    kind: "对侧互斥",
    measured: 1354,
    note: "禁 `?.`，而 typescript/prefer-optional-chain 正在要求把 && 链改成 `?.`",
  },
  "oxc/no-rest-spread-properties": {
    kind: "对侧互斥",
    measured: 550,
    note: "禁对象 spread，而 ES2024 目标与官方声明的投影写法都靠它",
  },

  // ===== 文体作用域：测试替身与构建脚本 =====
  "typescript/no-explicit-any": {
    kind: "文体作用域",
    measured: 1,
    note: "用例里的桩件面（mini-react 之类）需要 any 才塞得进官方签名",
  },
  "typescript/no-non-null-assertion": {
    kind: "文体作用域",
    measured: 536,
    note: "用例里 `!` 是「前驱条件已成立」的最短写法",
  },
  "typescript/no-unsafe-type-assertion": {
    kind: "文体作用域",
    measured: 844,
    note: "桩件需要 `as never` / `as unknown as` 跨官方名义类型",
  },
  "typescript/require-await": {
    kind: "文体作用域",
    measured: 467,
    note: "官方 async 契约的同步实现与测试替身撑不住这条；prod 侧的条数按代码修，不进豁免",
  },
  "eslint/require-await": {
    kind: "对侧互斥",
    measured: 481,
    note:
      "它与 typescript/require-await 是同一条判据的两份实现，不是两条判据：探针实测（一段无 await 的 " +
      "async 函数、--type-aware）单开各自都报、同开报两次 ⇒ 2 errors / 1 defect。" +
      "按 typescript-eslint 官方的 extension-rule 口径裁决：留带类型信息的扩展那条、关基线那条。" +
      "覆盖面没有因此变小：全仓逐行去重实测 514 行两点同报、typescript 独有 0 行、eslint 独有只落在" +
      "用例面与配置自身的中间态；而 --type-aware 实测对 .mjs 也会由扩展那条报出，" +
      "所以 scripts/*.mjs 面不需要基线那条补位。用例文件由 TEST_OVERRIDES 整族豁免",
  },
  "eslint/max-statements": {
    kind: "文体作用域",
    measured: 549,
    note: "用例体天然长（given/when/then 展开）",
  },
  "eslint/max-lines-per-function": { kind: "文体作用域", measured: 365, note: "同上" },
  "eslint/max-lines": {
    kind: "文体作用域",
    measured: 54,
    note: "单个用例文件的长度不作为缺陷信号",
  },
  "node/no-sync": {
    kind: "文体作用域",
    measured: 299,
    note: "构建脚本与门禁脚本按设计同步读；生产代码的写侧由每包 syncWrites 逐项登记，不在豁免里",
  },
  "node/no-top-level-await": {
    kind: "文体作用域",
    measured: 53,
    note: "脚本以 node 直接执行，顶层 await 是 ESM 常态；prod 侧 0 条",
  },
  "typescript/strict-boolean-expressions": {
    kind: "文体作用域",
    measured: 0,
    note: "scripts/*.mjs 无类型面，隐式 any 上无从判定",
  },
  "typescript/no-implied-eval": {
    kind: "文体作用域",
    measured: 0,
    note: "同上：这条要类型信息才能判",
  },
  "typescript/no-unsafe-member-access": {
    kind: "文体作用域",
    measured: 0,
    note: "无类型标注的脚本里每个值都落进隐式 any",
  },
  "typescript/no-unsafe-call": {
    kind: "文体作用域",
    measured: 0,
    note: NOTE_UNSAFE_SAME_AS_MEMBER_ACCESS,
  },
  "typescript/no-unsafe-assignment": {
    kind: "文体作用域",
    measured: 0,
    note: NOTE_UNSAFE_SAME_AS_MEMBER_ACCESS,
  },
  "typescript/no-unsafe-return": {
    kind: "文体作用域",
    measured: 0,
    note: NOTE_UNSAFE_SAME_AS_MEMBER_ACCESS,
  },
  "typescript/no-unsafe-argument": {
    kind: "文体作用域",
    measured: 0,
    note: NOTE_UNSAFE_SAME_AS_MEMBER_ACCESS,
  },
  "typescript/require-array-sort-compare": {
    kind: "文体作用域",
    measured: 0,
    note: "无类型脚本里「比较器缺失」判不出来",
  },
  "unicorn/no-process-exit": {
    kind: "文体作用域",
    measured: 2,
    note: "CLI 脚本的 process.exit 就是它的返回方式",
  },
  "eslint/no-continue": {
    kind: "文体作用域",
    measured: 53,
    note: "只对 scripts/ 豁免：TS 侧实测 0 条（包代码本来就不用 continue），908 行的门禁脚本改成嵌套 if 只会更难读",
  },
  "unicorn/max-nested-calls": {
    kind: "文体作用域",
    measured: 59,
    note: "只对 scripts/ 豁免：TS 侧实测 0 条；CLI 脚本里链式 map/filter/join 的深度由数据形状决定，不指向缺陷",
  },
  "unicorn/no-useless-undefined": {
    kind: "文体作用域",
    measured: 0,
    note: "脚本侧同上调；prod 仍按配置项 checkArguments:false 生效",
  },

  // ===== react 插件（owner 拍板开面）的存量处置 =====
  // 前五条是 React Compiler 实验面（上游默认关闭），与 client 卡片的「宿主挂载适配器」形态
  // 整体冲突：卡片在 effect 里同步宿主态到 store、渲染期读 ref、内联闭包传 hook，是适配器
  // 形态而非交互组件渲染形态。单项收敛（useSyncExternalStore 化、闭包提升）留给源码收敛批次；
  // measured 为开面实测条数（58 条里除 react-hooks 7 条外的全部）。
  "react/set-state-in-effect": {
    kind: "契约冲突",
    measured: 16,
    note: "卡片用 effect 同步宿主态到 store 是挂载适配器形态；Compiler 建议的 render 期推导要改写 12 份适配器的状态流",
  },
  "react/no-deriving-state-in-effects": {
    kind: "契约冲突",
    measured: 7,
    note: "适配器形态里「props/state 派生值在 effect 对齐宿主」是挂载动作，不是可下沉到 render 的纯派生",
  },
  "react/exhaustive-effect-dependencies": {
    kind: "契约冲突",
    measured: 8,
    note: "Compiler 版依赖审计对适配器的内联闭包全量追问；与 react-hooks/exhaustive-deps（保留并已修）形成双门，留后者",
  },
  "react/hooks": {
    kind: "契约冲突",
    measured: 13,
    note: "「同一 hook 函数跨渲染同引用」在适配器的内联闭包形态下整体不成立；收敛批次把闭包提升后再回来开",
  },
  "react/refs": {
    kind: "契约冲突",
    measured: 1,
    note: "挂载适配器在 render 期读 ref 对齐宿主布局；收敛批次改成挂载后读",
  },
  "react/todo": {
    kind: "上游不推荐",
    measured: 6,
    note: "报的是 React 编译器 BuildHIR 自己不支持 try/catch(-finally) 的上游 TODO，不是代码缺陷",
  },
  "react/rules-of-hooks": {
    kind: "文体作用域",
    measured: 3,
    note: "只对用例文件豁免（TEST_FILE_OVERRIDES）：测试架在组件树外直接驱动卡片适配 hook（useCardOf / useSyncExternalStore 桩），调用次数顺序由桩件固定。键用表载前缀 react/（诊断文案显示 react-hooks(...) 是显示名，配置键以 --rules 的 Source 列为准）",
  },
};

/**
 * 旧 `.oxlintrc.json` 里继承来、此次**取消豁免**且确实零代价的规则。
 *
 * 这里原来记着三条。"零代价"那句话是用 `oxlint --deny=<rule>` 量的，而 `--deny` 盖不住
 * override 层的 off（本文件头注释里有这条实测口径）——重测之后：`eslint/no-continue` 在
 * `scripts/` 有 53 条、`eslint/no-await-in-loop` 有 2 条，于是这两条按文体收窄回
 * `SCRIPTS_OVERRIDES`（TS 侧仍 0 条、仍生效），从这份"已作废"名单里撤掉。留在这儿的
 * 才是真正确认过零代价的。
 */
export const RETIRED_OFFS: string[] = ["typescript/no-empty-object-type"];

export const READONLY_SYNC_ALLOWLIST: string[] = [
  "existsSync",
  "readFileSync",
  "readdirSync",
  "readSync",
  "realpathSync",
  "statSync",
];

const BASE_PLUGINS: NonNullable<OxlintConfig["plugins"]> = [
  "eslint",
  "typescript",
  "unicorn",
  "oxc",
  "node",
  "promise",
  "vitest",
  "import",
  // react（捆 react / react-hooks / react-refresh / React Compiler 四个规则面）+ jsx-a11y：
  // 11 个带 client 半的包的卡片面是 React（createElement 形态），这两个规则面是 owner 拍板要吃的。
  // 存量按本仓口径处置：能修的修，确属形态冲突的进 OFF_JUSTIFICATIONS（kind+measured+note）。
  "react",
  "jsx-a11y",
];

/**
 * oxlint 的 **JS plugin** 面（`jsPlugins`，官方标注 alpha、不受 semver 保护）挂
 * `eslint-plugin-sonarjs`，补上"同形/重复"这一类 oxlint 内建没有的判据。
 *
 * 入口必须是**能解析到文件的路径**：实测裸包名 `eslint-plugin-sonarjs` 在 pnpm 布局里
 * 从包目录报 `Cannot find module`（它装在 workspace 根的 node_modules 下），配置就整份加载失败。
 * 所以这里在装载期用 `createRequire` 从本模块解析，绝对路径不落进任何配置文件。
 */
const SONARJS_ENTRY = createRequire(import.meta.url).resolve("eslint-plugin-sonarjs/cjs/plugin.js");

/**
 * 逐条点名而不是通配：JS plugin 的 alpha 面里，一条规则改名或新增就可能整份配置解析失败
 * （oxlint 对未知规则名的行为是**整份配置拒绝加载**，比静默保绿更糟）。
 * 挂载集合与实测条数一并写在这里（owner 的口径：挂上就当场全修，不留待办、
 * 不靠关规则过关）：`no-duplicate-string` 全仓 291 条、`cognitive-complexity` 22 条按代码修完，
 * 两条都用**默认阈值**，不调 option（调阈值就是把判据改成能过的那副样子）。
 */
const SONARJS_RULES: RuleTable = {
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-duplicated-branches": "error",
  "sonarjs/no-all-duplicated-branches": "error",
  "sonarjs/no-collapsible-if": "error",
  "sonarjs/no-identical-conditions": "error",
  "sonarjs/no-identical-expressions": "error",
  "sonarjs/no-duplicate-string": "error",
  "sonarjs/cognitive-complexity": "error",
  "sonarjs/max-switch-cases": "error",
  "sonarjs/no-inverted-boolean-check": "error",
  "sonarjs/no-duplicate-in-composite": "error",
  "sonarjs/duplicates-in-character-class": "error",
  "sonarjs/no-useless-catch": "error",
  "sonarjs/no-extra-arguments": "error",
  "sonarjs/no-redundant-assignments": "error",
  "sonarjs/prefer-single-boolean-return": "error",
  "sonarjs/label-position": "error",
};

const BASE_CATEGORIES: NonNullable<OxlintConfig["categories"]> = {
  correctness: "error",
  suspicious: "error",
  style: "error",
  perf: "error",
  restriction: "error",
  pedantic: "error",
  nursery: "error",
};

/**
 * `options` 是 **root-only** 字段：从上层目录一次 lint 多个包时，oxlint 会硬报
 * `The options.typeAware option is only supported in the root config`。
 * 因此「每包一份配置」的拓扑只能以包目录为 cwd 跑（`pnpm -r run lint` 天然满足），
 * workspace 根那份只管 `scripts/`。
 */
const BASE_OPTIONS: NonNullable<OxlintConfig["options"]> = {
  typeAware: true,
  typeCheck: true,
  denyWarnings: true,
  maxWarnings: 0,
  reportUnusedDisableDirectives: "error",
  respectEslintDisableDirectives: false,
};

/**
 * 排除面只留"生成物与非源码树"：`client.js`/`host.js` 是 build 产物，`coverage/`、`dist/`、
 * `.toolchain/`、`node_modules/` 同理。
 *
 * 这里原本还排着 `*.config.mjs`、`*.config.ts`、`build-client.mjs`、`build-host.mjs`，此次删掉：
 * 那四类是**人写的源码**，排掉就等于给它们开了盲区——实测因此攒过 5 条指向根本不会被 lint 的
 * 规则的僵尸 `oxlint-disable`（quality-gate/build-client.mjs，删除后无任何判据报出），
 * 而且和 `scripts/*.mjs` 的处理自相矛盾（同为 node 直跑的 .mjs，那边全量在 lint）。
 * 配置文件与 bundler 脚本现在和各包源码走同一套规则，`*.mjs` 仍由 SCRIPTS_OVERRIDES
 * 按文体收窄（类型信息类规则对无类型 .mjs 无从计算）。
 */
const BASE_IGNORE_PATTERNS: string[] = [
  "**/node_modules/**",
  ".toolchain/**",
  "coverage/**",
  "dist/**",
  "client.js",
  "host.js",
];

/**
 * oxlint 认识的 vitest 规则全集（取自 `oxlint --rules` 的表格，73 条）。整族在基线 off，再由
 * TEST_FILE_OVERRIDES 在用例文件上 on —— 理由见
 * OFF_JUSTIFICATIONS 里的 `vitest/*`。列成数组而不是散着写，是为了让「上游新增一条 vitest 规则」
 * 默认落在生产文件之外，而不是默认作用到每一个 host.ts。
 */
const VITEST_ALL_RULES: string[] = [
  "vitest/consistent-each-for",
  "vitest/consistent-test-filename",
  "vitest/consistent-test-it",
  "vitest/consistent-vitest-vi",
  "vitest/expect-expect",
  "vitest/hoisted-apis-on-top",
  "vitest/max-expects",
  "vitest/max-nested-describe",
  "vitest/no-alias-methods",
  "vitest/no-commented-out-tests",
  "vitest/no-conditional-expect",
  "vitest/no-conditional-in-test",
  "vitest/no-conditional-tests",
  "vitest/no-disabled-tests",
  "vitest/no-duplicate-hooks",
  "vitest/no-focused-tests",
  "vitest/no-hooks",
  "vitest/no-identical-title",
  "vitest/no-import-node-test",
  "vitest/no-importing-vitest-globals",
  "vitest/no-interpolation-in-snapshots",
  "vitest/no-large-snapshots",
  "vitest/no-mocks-import",
  "vitest/no-restricted-matchers",
  "vitest/no-restricted-vi-methods",
  "vitest/no-standalone-expect",
  "vitest/no-test-prefixes",
  "vitest/no-test-return-statement",
  "vitest/no-unneeded-async-expect-function",
  "vitest/padding-around-after-all-blocks",
  "vitest/padding-around-test-blocks",
  "vitest/prefer-called-exactly-once-with",
  "vitest/prefer-called-once",
  "vitest/prefer-called-times",
  "vitest/prefer-called-with",
  "vitest/prefer-comparison-matcher",
  "vitest/prefer-describe-function-title",
  "vitest/prefer-each",
  "vitest/prefer-equality-matcher",
  "vitest/prefer-expect-assertions",
  "vitest/prefer-expect-resolves",
  "vitest/prefer-expect-type-of",
  "vitest/prefer-hooks-in-order",
  "vitest/prefer-hooks-on-top",
  "vitest/prefer-import-in-mock",
  "vitest/prefer-importing-vitest-globals",
  "vitest/prefer-lowercase-title",
  "vitest/prefer-mock-promise-shorthand",
  "vitest/prefer-mock-return-shorthand",
  "vitest/prefer-snapshot-hint",
  "vitest/prefer-spy-on",
  "vitest/prefer-strict-boolean-matchers",
  "vitest/prefer-strict-equal",
  "vitest/prefer-to-be",
  "vitest/prefer-to-be-falsy",
  "vitest/prefer-to-be-object",
  "vitest/prefer-to-be-truthy",
  "vitest/prefer-to-contain",
  "vitest/prefer-to-have-been-called-times",
  "vitest/prefer-to-have-length",
  "vitest/prefer-todo",
  "vitest/require-awaited-expect-poll",
  "vitest/require-hook",
  "vitest/require-local-test-context-for-concurrent-snapshots",
  "vitest/require-mock-type-parameters",
  "vitest/require-test-timeout",
  "vitest/require-to-throw-message",
  "vitest/require-top-level-describe",
  "vitest/valid-describe-callback",
  "vitest/valid-expect",
  "vitest/valid-expect-in-promise",
  "vitest/valid-title",
  "vitest/warn-todo",
];

/** 整族在用例文件上开回来时仍然豁免的那几条（理由逐条在 OFF_JUSTIFICATIONS）。 */
const VITEST_STILL_OFF_IN_TEST_FILES = new Set<string>([
  "vitest/max-expects",
  "vitest/no-conditional-in-test",
  "vitest/no-hooks",
  "vitest/no-importing-vitest-globals",
  "vitest/prefer-called-times",
  "vitest/prefer-describe-function-title",
  "vitest/prefer-expect-assertions",
  "vitest/prefer-import-in-mock",
  "vitest/prefer-importing-vitest-globals",
  "vitest/prefer-to-be-falsy",
  "vitest/prefer-to-be-truthy",
  "vitest/require-test-timeout",
]);

export const BASE_RULES: RuleTable = {
  "eslint/one-var": ["error", "never"],
  "eslint/func-style": [
    "error",
    "declaration",
    { allowArrowFunctions: true, overrides: { namedExports: "ignore" } },
  ],
  "eslint/id-length": ["error", { exceptions: ["a", "i", "t", "x", "y", "z"] }],
  "eslint/init-declarations": ["error", "never", { ignoreForLoopInit: true }],
  "eslint/max-lines": ["error", { max: 2000, skipBlankLines: true, skipComments: true }],
  "eslint/max-lines-per-function": [
    "error",
    { max: 120, skipBlankLines: true, skipComments: true },
  ],
  "eslint/complexity": "error",
  "eslint/max-params": ["error", { max: 5 }],
  "eslint/max-statements": ["error", 50],
  "eslint/no-console": ["error", { allow: ["warn", "error", "info"] }],
  "eslint/no-param-reassign": "error",
  "eslint/no-underscore-dangle": [
    "error",
    {
      allow: [
        "__memoryInsightCardApplied",
        "__memoryTdaiCardApplied",
        "__sessionRescueApplied",
        "__wukilDevToolsCardApplied",
      ],
    },
  ],
  // 口味类整族关掉（no-magic-numbers / sort-keys / capitalized-comments / no-ternary …），
  // 每条的类别与实测条数在 OFF_JUSTIFICATIONS 里；配置加载会要求它们在册。
  "eslint/no-magic-numbers": "off",
  "eslint/sort-keys": "off",
  "eslint/sort-imports": "off",
  "eslint/capitalized-comments": "off",
  "eslint/no-ternary": "off",
  "eslint/no-undefined": "off",
  "eslint/no-void": "off",
  "eslint/no-duplicate-imports": "off",
  // require-await 一族：`eslint/require-await` 与 `typescript/require-await` 是同一条判据的两份实现，
  // 同开会把一个缺陷报两次（实测同一段无 await 的 async 函数在 --type-aware 下报 2 errors / 1 defect）。
  // 按 typescript-eslint 对 extension rule 的官方口径留扩展那条、关基线那条；全仓实测两面的判据
  // 面在非用例代码上重合（逐行去重：514 行同点、typescript 独有 0 行、eslint 独有只有本配置
  // 自己的一份中间态），而 `options.typeAware: true` 是常开的 ⇒ .mjs/.cjs 也归扩展那条管
  //（实测 --type-aware 下它对 .mjs 同样报出）。用例文件仍整族豁免（见 TEST_OVERRIDES）。
  "eslint/require-await": "off",
  // import 插件按契约类开（no-cycle / named / first 走 categories），下面这几条与官方形态
  // 冲突或属口味，理由与条数在册。
  "import/no-named-export": "off",
  "import/group-exports": "off",
  "import/exports-last": "off",
  "import/prefer-default-export": "off",
  "import/no-nodejs-modules": "off",
  "import/no-relative-parent-imports": "off",
  "import/max-dependencies": "off",
  // 官方 cordis 入口形态就是 default export：`vendor/cordis/src/registry.ts:92` 读
  // name/Config/apply，`vendor/loader/src/index.ts:201` 先 unwrap `default`。
  // 禁止默认导出等于禁止 12 个 bundle 的入口写法，属契约冲突而非噪声。
  "import/no-default-export": "off",
  // 实测 12 条 = 12 个 bundle 入口（独立 -c 探针逐包复测，含测试文件同为 12）：
  // 官方入口形态就是 `export default { name, Config, apply }`
  // （vendor/cordis/src/registry.ts:92 直接读这三个字段），要求先具名再导出等于改官方形态。
  "import/no-anonymous-default-export": "off",
  // 具名导出的默认对象上做成员访问是本仓对 cordis 官方声明的常态用法。
  "import/no-named-as-default-member": "off",
  // 顶层 `import type { X }` 267 处 vs 行内 156 处：混用本身就是「配置格式不统一」的一个实测轴，
  // 方向取多数形态。
  "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
  "import/no-duplicates": "error",
  "import/no-cycle": "error",
  "import/named": "error",
  "import/first": "error",
  "import/newline-after-import": "error",
  "node/no-process-env": "off",
  "node/no-sync": ["error", { ignores: READONLY_SYNC_ALLOWLIST }],
  "node/no-top-level-await": "error",
  "oxc/no-async-await": "off",
  "oxc/no-optional-chaining": "off",
  "oxc/no-rest-spread-properties": "off",
  "promise/always-return": "error",
  "promise/no-promise-in-callback": ["error", { exemptDeclarations: true }],
  "promise/no-return-wrap": "error",
  "promise/param-names": "error",
  // `.then` 链与仓库选定的 async/await 侧冲突：开 error，让 13 条存量按代码改成 await。
  "promise/prefer-await-to-then": "error",
  "typescript/consistent-type-imports": ["error", { disallowTypeAnnotations: false }],
  "typescript/explicit-function-return-type": [
    "error",
    {
      allowDirectConstAssertionInArrowFunctions: true,
      allowExpressions: true,
      allowHigherOrderFunctions: true,
      allowIIFEs: true,
      allowTypedFunctionExpressions: true,
      allowedNames: ["handler", "callback"],
    },
  ],
  "typescript/no-explicit-any": "error",
  "typescript/no-floating-promises": "error",
  "typescript/no-unsafe-assignment": "error",
  "typescript/no-unsafe-type-assertion": "error",
  "typescript/no-non-null-assertion": "error",
  "typescript/require-await": "error",
  "typescript/prefer-readonly-parameter-types": "off",
  "typescript/promise-function-async": ["error", { checkArrowFunctions: false }],
  "typescript/consistent-return": ["error", { treatUndefinedAsUnspecified: true }],
  "typescript/only-throw-error": "error",
  "unicorn/no-array-reduce": ["error", { allowSimpleOperations: true }],
  "unicorn/no-null": "off",
  "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
  // ===== react 插件的 React Compiler 实验面（上游默认关闭）：与 client 卡片的「宿主挂载
  // 适配器」形态整体冲突（effect 同步宿主态到 store、渲染期读 ref、内联闭包传 hook 是
  // 适配器形态而非交互组件渲染形态）。单项收敛（useSyncExternalStore 化、闭包提升）留给
  // 源码收敛批次；measured 为开面实测条数，依据逐条在 OFF_JUSTIFICATIONS。
  // react-hooks/exhaustive-deps 与 rules-of-hooks 不在豁免面内：前者 src 侧 4 条已逐站点
  // 结构性修复（稳定化回调 + 补依赖），后者只对用例文件在 TEST_FILE_OVERRIDES 豁免。
  "react/set-state-in-effect": "off",
  "react/no-deriving-state-in-effects": "off",
  "react/exhaustive-effect-dependencies": "off",
  "react/hooks": "off",
  "react/refs": "off",
  "react/todo": "off",
  // nursery 的 11 条类型感知规则整体吃下。`no-unnecessary-condition` 逐站点判：
  // 类型确实非空就删冗余的 `?.` / `??`；运行时真会为空则是类型不准，改宽类型让守卫保留且规则不再报。
  // 用关规则代替这个判断是本仓明令禁止的路径。
  ...Object.fromEntries(VITEST_ALL_RULES.map((rule) => [rule, "off"])),
};

const TEST_FILES: string[] = ["**/*.test.ts", "**/*.test.tsx", "**/test/**", "**/__tests__/**"];

/**
 * 用例文件（含 `test/*.ts` 夹具与 helper）共享的豁免：规模类，以及「桩件要跨官方名义类型」
 * 的类型类判据。vitest 的用例结构类判据不在这里 —— 它们在基线整族 off、只在
 * TEST_FILE_OVERRIDES 里开回来，所以 helper 模块天然不在射程内，旧配置那份按目录豁免的
 * TEST_HELPER_OVERRIDES 因此作废。
 */
export const TEST_OVERRIDES: OxlintOverride = {
  files: TEST_FILES,
  rules: {
    "typescript/no-non-null-assertion": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/no-explicit-any": "off",
    "typescript/require-await": "off",
    "eslint/max-statements": "off",
    "eslint/max-lines": "off",
    "eslint/max-lines-per-function": "off",
    "node/no-top-level-await": "off",
  },
};

/**
 * vitest 的用例结构类判据**只**在这里生效。
 * `expect-expect` 的 `assertFunctionNames` 取 vitest flavor 的官方默认
 * （`["expect", "expectTypeOf", "assert", "assertType"]`）：本仓用例里有相当一部分用
 * `node:assert/strict` 断言，那不是「缺断言」，而是这条规则在 jest flavor 默认值下漏判
 * ——实测 17 条里 5 条属于这一族，补上默认值后就不报了。
 *
 * 剩下两族用规则自带的选项解决，不关规则、也不改判据方向：
 *  - 断言写在包内 helper 里（`assertSameLedger()` 一类）：`assertFunctionNames` 就是
 *    "哪些函数算断言"的名单，走 {@link makeTestFileOverrides} 的 `assertionHelpers` 报名字。
 *    名单只收**裸标识符**：带 `*` / `.` 的通配会把"任何调用都算断言"写进配置，等于掏空规则，直接抛。
 *  - 标题以大写术语开头（`PTC`、`W5`、`B1` 这类档位/模式名）：`allowedPrefixes` 是
 *    prefer-lowercase-title 给的同一条口径（官方例子就是 HTTP 方法前缀）。走 `titlePrefixes` 报名字。
 *    反过来的做法——把标题改成 `pTC` / `w5`——会把领域名字改成坏名字，本仓不采取。
 */
export const VITEST_ASSERTION_DEFAULTS: string[] = [
  "expect",
  "expectTypeOf",
  "assert",
  "assertType",
];

const BARE_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/u;

export const TEST_FILE_OVERRIDES: OxlintOverride = {
  files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.spec.ts"],
  rules: {
    ...Object.fromEntries(
      VITEST_ALL_RULES.filter((rule) => !VITEST_STILL_OFF_IN_TEST_FILES.has(rule)).map((rule) => [
        rule,
        "error",
      ]),
    ),
    "vitest/expect-expect": ["error", { assertFunctionNames: VITEST_ASSERTION_DEFAULTS }],
    // 测试架在组件树外直接驱动卡片适配 hook（dir-prep 的 useCardOf、memory-insight 的
    // useSyncExternalStore 桩）是刻意的测试形态：hook 调用次数/顺序由桩件保证固定
    // （见 memory-insight test/client-lifecycle.test.ts 的同构注释）。rules-of-hooks 的
    // 「必须在组件或自定义 hook 里」对这批直接驱动不成立，只在用例文件上豁免。
    "react/rules-of-hooks": "off",
  },
};

/**
 * 生成用例文件的 override（vitest 结构类判据的开与关都在这张表里）。
 * @param assertionHelpers - 本包"内部会断言"的 helper 函数名，并入 `expect-expect` 的名单。
 * @returns 可直接放进 `overrides` 的配置项。
 */
export interface TestFileOverridesOptions {
  /** 本包"内部会断言"的 helper 函数名，并入 `vitest/expect-expect` 的名单。 */
  assertionHelpers?: string[];
  /** 允许作为用例/套件标题开头的大写术语，并入 `vitest/prefer-lowercase-title` 的 allowedPrefixes。 */
  titlePrefixes?: string[];
}

/**
 * 生成用例文件的 override（vitest 结构类判据的开与关都在这张表里）。
 * @param opts - 本包需要用规则自带选项登记的名单（见文件头的两族说明）。
 * @returns 可直接放进 `overrides` 的配置项。
 */
export function makeTestFileOverrides(opts: TestFileOverridesOptions = {}): OxlintOverride {
  const assertionHelpers = opts.assertionHelpers ?? [];
  const titlePrefixes = opts.titlePrefixes ?? [];
  const illegal = [...assertionHelpers, ...titlePrefixes].filter(
    (name) => !BARE_IDENTIFIER_RE.test(name),
  );
  if (illegal.length > 0) {
    throw new Error(
      `assertionHelpers / titlePrefixes 只收裸标识符，不接受通配或带点形式（前者等于把 vitest/expect-expect 掏空）：${illegal.join(", ")}`,
    );
  }
  const names = [...new Set([...VITEST_ASSERTION_DEFAULTS, ...assertionHelpers])];
  return {
    ...TEST_FILE_OVERRIDES,
    rules: {
      ...TEST_FILE_OVERRIDES.rules,
      "vitest/expect-expect": ["error", { assertFunctionNames: names }],
      ...(titlePrefixes.length === 0
        ? {}
        : {
            "vitest/prefer-lowercase-title": [
              "error",
              { allowedPrefixes: [...new Set(titlePrefixes)] },
            ],
          }),
    },
  };
}

export const SCRIPTS_OVERRIDES: OxlintOverride = {
  files: ["scripts/**", "*.mjs", "*.mts"],
  rules: {
    // 这三条在 TS 侧全部是 0 条 ⇒ 包代码本身已经按它们写，只对 node 直跑的门禁/构建脚本豁免：
    // 那批脚本的控制流形态就是 guard-continue（908 行的门脚本改成嵌套 if 只会更难读），
    // 而 unicorn/max-nested-calls 与 eslint/id-length 在 CLI 脚本里指向上限口味，不指向缺陷。
    // 数的是实测条数：no-continue 53、max-nested-calls 59、id-length 32（scripts 面）。
    "eslint/no-continue": "off",
    "unicorn/max-nested-calls": "off",
    // 与基线同一条规则，只是把 node 脚本里的惯例短名加进白名单（不放宽 min/max，避免变成"另一套标准"）。
    "eslint/id-length": [
      "error",
      {
        exceptions: ["a", "i", "t", "x", "y", "z", "n", "p", "s", "v", "e", "f", "ok", "fs", "id"],
      },
    ],
    "unicorn/no-process-exit": "off",
    "unicorn/no-useless-undefined": "off",
    "typescript/no-non-null-assertion": "off",
    "node/no-sync": "off",
    "node/no-top-level-await": "off",
    // 这一族是**类型信息**规则：它们判的是「值在类型面上是 any/unknown」。
    // `scripts/*.mjs` 是 node 直接跑的门禁脚本，仓内没开 `checkJs`，也没有 TS 类型标注
    // ⇒ 每个值都落进隐式 any，实测 1658 条里 1428 条是这一族（不是 1428 个缺陷，
    // 而是这些规则在这里无从计算）。真正能判的仍全量保留：no-undef、no-unused-vars、
    // import/first、unicorn 的 correctness 类、eslint 的规模与可读性类。
    // 若日后把这些脚本迁成带类型的 .ts，这一族要跟着收回来。
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-return": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/no-implied-eval": "off",
    "typescript/require-array-sort-compare": "off",
  },
};

/**
 * 造一个"只读依据视图"：基线的 OFF_JUSTIFICATIONS 加上本次调用带进来的包级例外。
 * **刻意不往导出的那张表里写**（早先的实现是 `OFF_JUSTIFICATIONS[rule] = justification`）：
 * 配置模块在同一个 Node 进程里只求值一次，写过的那张表会让 A 包的例外替 B 包的无依据 off 背书
 * ——正是这道门要拦的情形，而且单测里已经复现过一次串味（上一条用例的例外让下一条负例变成正例）。
 */
function makeJustificationView(
  offReasons: Record<string, OffJustification>,
): (rule: string) => OffJustification | undefined {
  const merged: Record<string, OffJustification | undefined> = {
    ...OFF_JUSTIFICATIONS,
    ...offReasons,
  };
  return (rule: string): OffJustification | undefined => {
    const direct = merged[rule];
    if (direct !== undefined) {
      return direct;
    }
    const slash = rule.indexOf("/");
    return slash === -1 ? undefined : merged[`${rule.slice(0, slash)}/*`];
  };
}

/**
 * 每一条 `"off"` 都必须在 OFF_JUSTIFICATIONS 里有依据。抛错而不是「记一行日志」：
 * 配置加载失败会让 oxlint 当场红，把规则关掉这件事不可能静默穿过这道门
 * （实测过的同类失效形态：一条不存在的规则名让整份配置解析失败，13 个包全部静默 lint 0 条却 exit 0）。
 */
function assertOffsDocumented(
  where: string,
  rules: RuleTable | undefined,
  lookup: (rule: string) => OffJustification | undefined,
): void {
  if (rules === undefined) {
    return;
  }
  const undocumented: string[] = [];
  for (const [rule, setting] of Object.entries(rules)) {
    const severity = Array.isArray(setting) ? setting[0] : setting;
    if (severity === "off") {
      const found = lookup(rule);
      if (found === undefined || found.note.trim().length === 0) {
        undocumented.push(rule);
      }
    }
  }
  if (undocumented.length > 0) {
    throw new Error(
      `${where} 里这些规则被关成 off 但没有依据（OFF_JUSTIFICATIONS 查不到，或 note 为空）：${undocumented.join(", ")}。要么在代码里修，要么给它补一条 kind + measured + note。`,
    );
  }
}

export interface PluginLintOptions {
  syncWrites?: string[];
  extraRules?: RuleTable;
  extraOverrides?: OxlintOverride[];
  extraIgnorePatterns?: string[];
  /** 追加 oxlint JS plugin（alpha、不受 semver 保护）；包内自定义规则走这里。 */
  jsPlugins?: NonNullable<OxlintConfig["jsPlugins"]>;
  /** 包级豁免：每个 off 都要在这里写明 kind / measured / note，否则配置加载即抛错。 */
  offReasons?: Record<string, OffJustification>;
  /**
   * 本包"内部会断言"的用例 helper 名（如 `assertSameLedger`）。报进来的名字并入
   * `vitest/expect-expect` 的 `assertFunctionNames`，规则本身保持 error —— 这是规则给的口径，
   * 不是豁免。只收裸标识符，通配会掏空这条规则，直接抛。
   */
  assertionHelpers?: string[];
  /** 允许开头的用例标题大写术语（`PTC`/`W5`/`B1` 这类档位或模式名），进 allowedPrefixes。 */
  titlePrefixes?: string[];
}

export function definePluginConfig(options: PluginLintOptions = {}): OxlintConfig {
  const {
    syncWrites = [],
    extraRules = {},
    extraOverrides = [],
    extraIgnorePatterns = [],
    jsPlugins,
    offReasons = {},
    assertionHelpers = [],
    titlePrefixes = [],
  } = options;

  const lookup = makeJustificationView(offReasons);

  const rules: RuleTable = {
    ...BASE_RULES,
    ...SONARJS_RULES,
    ...(syncWrites.length > 0
      ? {
          "node/no-sync": [
            "error",
            {
              ignores: [...new Set([...READONLY_SYNC_ALLOWLIST, ...syncWrites])],
            },
          ],
        }
      : {}),
    ...extraRules,
  };

  const overrides = [
    TEST_OVERRIDES,
    makeTestFileOverrides({ assertionHelpers, titlePrefixes }),
    SCRIPTS_OVERRIDES,
    ...extraOverrides,
  ];

  assertOffsDocumented("rules", rules, lookup);
  for (const [index, override] of overrides.entries()) {
    assertOffsDocumented(`overrides[${index}]`, override.rules, lookup);
  }

  return defineConfig({
    plugins: BASE_PLUGINS,
    // 刻意不开 `env.vitest`：13 份 vitest 配置都没启用 `globals: true`，测试里裸用
    // describe/it/expect 属于未声明标识符，应由 no-undef 与 TS2593 报出来（实测确实报）。
    env: { node: true, es2024: true, browser: true },
    options: BASE_OPTIONS,
    categories: BASE_CATEGORIES,
    ignorePatterns: [...BASE_IGNORE_PATTERNS, ...extraIgnorePatterns],
    // sonarjs 这条 JS plugin 是常挂的（`SONARJS_RULES` 在 rules 里，缺入口就是整份配置加载失败，
    // 实测报 `Plugin 'sonarjs' not found`）；包内自带的入口追加在后面。
    jsPlugins: [SONARJS_ENTRY, ...(jsPlugins ?? [])],
    rules,
    overrides,
  });
}
