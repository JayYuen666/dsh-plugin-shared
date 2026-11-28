// test/dist-size.test.ts —— 产物体积上限检查。
//
// 为什么要有：`npm run check` 的顺序是 build 在 test 之前，所以这道检查读到的是**当轮刚产出**的
// dist，不是上一次遗留的。它挡的是两类回退：
//   1. 有人关掉 build-host.mjs / build-config.mjs 的 minify —— 运行期体积弹回未压缩态；
//   2. 有人在某个构建切面里塞进大对象字面量或整段查表。
// 两类都不会让任何现有用例变红（体积不是行为），所以必须单独有一道按字节数的检查。
//
// 预算怎么定的：在当前实测值上加约 25%。留这 25% 是给正常演进的——加一个导出、改一条错误文案
// 不该立刻要人改预算；但翻倍一定会顶穿。真需要突破时，改这两个常量并写明理由。
//
// 刻意不单独设限的一项：barrel 不单独一条线。压缩后它反而变大，因为打包器把
// re-export 的具名清单展开了；单看它会得出「压缩有害」的错误结论，所以按总量算。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const pkgDir = path.resolve(import.meta.dirname, "..");

/** 运行期产物预算（在实测值上加一档取整）。消费方按 `./tool` / `./client` 两条入口 external 取用，
 *  这些字节是真实装载成本。
 *  card-ui 是客户端组件子路径（含统一样式表），按消费方 external 取用。0.2.9 实测 36775 B：
 *  ① 两条样式规则（`.dsu-form` 的 border-box 让 `width:100%` 的输入框不再撑出容器；小节直系子节点
 *  之间补 10px 纵向节奏）；② `useInvalidFields()` / `withInvalidField` 收上来，七仓各删一份越界
 *  状态机；③ `registerSkill`、`fillPlaceholders` 与 `truncateCodePoints` 三个共用实现落地，
 *  分别替掉三份 skill 注册、六个插值副本与三处码点截断循环。
 *  只按本次实际增量上调，不重新套用 +25%——避免正常演进吃掉护栏后门槛一路放宽。
 *  再一轮 36775 → 36888 B（+113）：吸底保存条改成半透明 + `backdrop-filter`，替掉写死的
 *  `var(--dsw-alias-bg-base)`——那条不透明底色在宿主「设置」对话框的 bg-layer-2 面板上
 *  是一条比四周更暗的横带。`-webkit-` 前缀一份，故两个方向的字节都涨。
 *  再一轮 36888 → 36935 B（+47）：保存条两条规则改成类名双写（`.dsu-savebar.dsu-savebar`），
 *  把特异性从 (0,1,0)/(0,2,0) 抬到 (0,2,0)/(0,3,0)。旧版插件的 style id 有两种：scrapling
 *  那一代用包私有 id；danger-guard/ocr/rtk 等更近的旧版仍用固定 id `dsh-card-ui-css`，
 *  会被「已有就跳过」的判据占住。旧一代的 `.dsu-savebar{…background:var(--dsw-alias-bg-base)}`
 *  会在脏态之外也铺出底色；级联逐属性比较、插入顺序不可控，所以既要双类名抬特异性，
 *  也要在注入层补覆盖样式。基础规则同时显式写下 `background:transparent`——不写就等于
 *  把这一位让给旧规则（级联不会因为高特异性规则「没声明」而屏蔽低特异性的声明）。
 *  再一轮 36935 → 37065 B（+130）：`lib/skill.ts` 的 `registerSkill` 加两件事——把宿主
 *  `register()` 交回的 disposer 经调用方 `ctx.effect` 接管（卸载后 skill 不再留在模型目录里），
 *  以及把注册期的抛错吞成 false（同名二次注册 / `validateDefinition` 拒绝不能让整条 fiber
 *  落 failed）。两个 `try` 与 `SkillRegistryContext` 的类型面就是要涨的这一截。
 *  再一轮 37065 → 37624 B（+559）：`ensureCardUiCss` 在固定 id 已被旧版占住时改注入独立的
 *  `dsh-card-ui-css-override`（带内容版本，避免旧 bundle 把正文降级），以及吸底保存条
 *  `color-mix` 前的主题色兜底。
 *  受影响的公共面：`SkillRegistryContext` 在 `get` 之外多了可选 `effect`（向后兼容：
 *  只传 `get` 的老调用点照旧编译）；同步面：`CHANGELOG.md` 当期版本段，
 *  以及三个消费仓的 `lib/skill.ts` 薄壳（它们只转发 `ctx`，无需改）。
 *  再一轮 37624 → 52534 B（+14910）：card-ui v2——样式表重写（悬停起底字段行、3px 业务色焦点环、
 *  业务色开关与主按钮、保存条面板化）并新增九组展示组件（Badge/StatusDot/Callout/KPI/
 *  DataTable/Meter/LogPanel/Segmented/EmptyState/ToolRow），九仓各自手搓的私加 CSS 由这套
 *  组件收回 shared（各仓净删的样式字节大于这里的增量）。`CARD_UI_CSS_VERSION` 同步升到 2。
 *  受影响的公共面：`./client` 的 card-ui 导出面（新增九组组件与类型，纯加法）；同步面：
 *  各消费仓删除私有样式改用共享组件。
 *  再一轮 52534 → 54391 B（+1857）：DataTable 补 sticky 首列修饰（rtk 明细表换用 shared 的
 *  前提——冻结列/斑马纹/列宽技巧下沉）与保存条脏态状态字的独立类（session-rescue 的
 *  RetryPolicy 保存条从手拼改回 shared 形态的最后一步）。
 *  受影响的公共面：`DataTable` 增可选 `stickyFirst`（纯加法）。
 *  再一轮 54391 → 55459 B（+1068）：FieldTwoCol 双列字段栅格（设计稿的两列数字字段布局，
 *  session-rescue 消费）。
 *  受影响的公共面：新增 `FieldTwoCol`（纯加法）。
 *  再一轮 55459 → 55903 B（+444）：NumberField 的单位画进输入框内部右侧（设计稿
 *  .input-wrap 形态：`dsu-inputWithUnit` 的 padding-right、单位的绝对定位与
 *  pointer-events、隐藏 number 原生步进箭头的一组规则），外加 hint.ts 改写后的注释字节。
 *  受影响的公共面：无（纯样式与注释）。
 *  再一轮 55903 → 56663 B（+760）：省略格悬停浮层（EllipsisCell 组件替换原生 title——
 *  宿主 webview 不渲染原生 tooltip——含 `.dsu-tblTip` 样式与数值列表头右对齐的规则、
 *  斑马纹一条随设计稿移除）。
 *  受影响的公共面：`DataTable` 的 ellipsis 格改由组件渲染（DOM 形状多一层浮层 span，
 *  纯加法）。
 *  再一轮 56663 → 56718 B（+55）：浮层经 createPortal 挂到 body（冻结列是 sticky 定位
 *  元素、会劫持格内 fixed 的包含块），portal 那几行的代码字节。
 *  再一轮 56718 → 58805 B（+2087）：card-ui v3 视觉基线（字段行式排布、24px 帮助按钮、
 *  错误徽标/错误浮层、行式布尔项、保存条与 Insights 辅助样式）。
 *  受影响的公共面：`Field` 增 `layout`、`FieldBase` 增 `invalidText`（均为可选加法）。
 *  再一轮 59300 → 59577 B（+277）：card-ui v3 的 KPI/Callout/表脚/量条字号统一与
 *  `CARD_UI_CSS_VERSION` 升档（现值 3.1）；纯样式与版本常量，不引入宿主运行期代码。
 *  再一轮 59577 → 67179 B（+7602）：card-ui v3 表单基线补齐——InfoTip 双 placement/错误浮层、
 *  SecretField 眼睛按钮、ToggleGrid、bare Select、错误 ARIA 与容器查询（skills/card-ui 的
 *  运行期导出面同步长大）。
 *  再一轮 67179 → 69921 B（+2742）：card-ui v3 收尾（新增表单件、展示层可选位与样式、
 *  `nextDomId` 与数字框 inputMode）；实测 69921 B，预算 70000 B，余量 79 B，
 *  下一次增字节必须同步抬预算并在本轮账上记账。
 *  再一轮 70000 → 71000 B（+1000）：`card-apply` 的占位槽从普通下标读写改为
 *  descriptor-only（访问器/非占位值明确拒绝、claim 前缺席时精确删键），
 *  实测 70692 B。
 *  再一轮 71000 → 76000 B（+5000）：`path-scope`/`value`/`card-form`/`session-cwd`/`number`/
 *  `cli-safety` 六个跨仓纯函数模块落地（各替掉 2–15 份逐字副本），以及 `useCardDraft`
 *  接管七张设置卡的草稿层。实测 75374 B；这一档按实测 + 约 600 B 取整，不重套 +25%。
 *  再一轮 76000 → 78000 B（+2001）：`assertAbsoluteRoot` / `normalizeAbsolutePath` 的
 *  严格实现收进 `path-scope`（OCR 与 zvec 各删一份；`..` 越过文件系统根改为归一阶段拒绝，
 *  不再先折叠再判根），实测 76789 B。
 *  再一轮 78000 → 82500 B（+4000）：工具侧改为单一 `./tool` 入口（`dist/tool.js` 的
 *  re-export 清单与 20 个模块的 import 边），另加 `./tool` 的浏览器条件
 *  `dist/tool-browser.js`（双用源在 client 构建里只取纯件，避免把 Node 内置模块拖进
 *  浏览器 bundle；抬档时实测 81151 B，当前实测 79758 B）。模块产物本身不重复，增量就是
 *  这两条 barrel 的字节。
 */
const RUNTIME_BUDGET_BYTES = 82_500;
/** 客户端行预算：dist/client.js 由浏览器加载，不计入宿主运行期预算。
 *  压缩前历史读数 54,765 → 54,878 → 54,925 → 57,139 B，涨幅来自 card-ui 样式与注入兜底；
 *  这些改动的说明仍在 `lib/card-ui/styles.ts` 与 CHANGELOG。shared 自己的 build-client.mjs
 *  现在显式传 `minify: true`，当前实测 27,087 B（gzip 7,906 B），预算按实测值取整留一档。
 *  再一轮 27087 → 42877 B（+15790）：与运行期切面同因——card-ui v2 样式表与九组新展示组件
 *  整体打进这条 UMD（样式字符串在产物里原样保留，是本轮增量的主体）。
 *  再一轮 42877 → 44738 B（+1861）：与运行期同因（DataTable sticky 首列 + statusDirty）。
 *  再一轮 44738 → 45721 B（+983）：与运行期同因（单位入框的样式规则与 splitHint 改写）。
 *  再一轮 45721 → 46530 B（+809）：与运行期同因（省略格悬停浮层的组件与样式）。
 *  再一轮 46530 → 46653 B（+123）：NumberField 聚焦守卫（聚焦中不采纳外部值，与
 *  textField 聚焦契约对齐）与新展示组件 badge 一起打进客户端行。
 *  再一轮 49100 → 49551 B（+451）：card-ui v3 Insights 细节——KPI 底色改 card-tile、
 *  Callout 去左边框并统一 14px/16% 底、DataTable 等宽列/表脚/量条数值统一 12px，
 *  以及饼图标签取 label-primary 的取色位。纯样式与取色，不引入宿主运行期代码。
 *  再一轮 49551 → 57543 B（+7992）：与运行期同因（v3 表单基线、SecretField/ToggleGrid/bare
 *  Select、InfoTip 双态与容器查询全部打进这条 UMD）。
 *  再一轮 57543 → 59881 B（+2338）：card-ui v3 收尾与运行期同因；实测 59881 B，
 *  预算 60000 B，余量 119 B。
 *  再一轮 60000 → 61500 B（+1500）：同一轮 `card-apply` descriptor-only 加固进入
 *  shared/client；实测 61163 B。
 *  再一轮 63500 → 64000 B（+500）：客户端侧统一从 `./client` 取远程读取骨架
 *  （`remoteMounterOf` / `parseOrThrow`）、超时与夹位件，不再按 `./tool/*` 深引；
 *  shared 的 UMD 因此承载这几份公共实现，实测 63569 B。宿主运行期件未进入这条行。
 *  宿主侧子路径（`skill` / `placeholder`）不进这条 bundle。
 *  受影响的公共面：无（常量只在本用例内）；同步面：README 的 "What ships"。 */
const CLIENT_BUDGET_BYTES = 64_000;
/** 宿主运行期不装载客户端 bundle：UMD 由模块图在浏览器侧按行提供，ESM 只是 Node 测试与类型声明的入口。 */
const HOST_RUNTIME_EXCLUDE = new Set(["client.js", "client-entry.js"]);
/** 配置产物预算（在实测值上加一档取整）。构建期才加载，但整个 dist 都在 files 白名单里，一并计入 tarball。
 *  客户端行的测试别名（shared/client → 发布产物 client-entry.js）与 react 族别名、shared 内联规则
 *  把配置产物推到 30617 B（旧别名的读数是 30064 B），按同一 +25% 规则抬到 31000 B。
 *  再一轮 30617 → 32949 B（+2332）：jsPlugins 入口策略（对象 name 精确匹配命名空间、同一插件
 *  多条入口拒绝、ESM-only 的 import.meta.resolve 回退）、PROD/TEST 的 excludeFiles、
 *  SCRIPTS/UNTYPED 拆分与分层 off 依据校验。按本次实测增量抬到 33500 B（留约 550 B 余量，
 *  不重新套用 +25%）。
 *  再一轮 33500 → 34000 B（+500）：客户端测试别名改走包内 `dist/client-entry.js`（绝对路径
 *  比裸子路径长约 70 B），实测 33567 B；当前实测 33584 B。 */
const CONFIG_BUDGET_BYTES = 34_000;
/** 构建编排产物预算（dist/build/，各包 build-*.mjs 构建期取用）。与配置产物同一记录理由：
 *  不占插件运行期装载成本，但整目录随 tarball 发布。
 *  新增 `require-calls` 切面（产物 require 调用的 AST 判据，1299 B）后实测 22918 B；
 *  新增 `build-tool-imports` 切面（官方 transform 的 guard/tool-map 编排，3083 B）后实测
 *  26472 B；同一切面补齐「删除声明留空语句」「tool-map 自有条目快照 + 可路由名校验」
 *  「本地再导出拒绝」「import attributes 拒绝」「默认导出穿透 TS 包装」后实测 29160 B，
 *  按同一取整规则抬到 30000 B。
 *  再一轮 30000 → 36000 B（+6000）：`decorator-lowering` 的根因修复——源映射先解码到绝对坐标再
 *  重新编码（VLQ 编解码）、map 字段与单源约束校验、按 AST 识别 tsc 注入的 metadata/`__esDecorate`
 *  样板、tsc 的 stdout/stderr/status/signal 捕获，以及把 `code` 写进同后缀临时文件再编译。
 *  实测 35217 B；这一档是修复坐标漂移与语义丢失的承重件，不重套 +25%。 */
const BUILD_BUDGET_BYTES = 36_000;

/**
 * 某目录下所有 .js 的字节合计（**不递归**）。
 *
 * 不递归是刻意的：dist/ 一层就是运行期产物，dist/config 是配置产物，两者本来就分开记录。
 * 这里曾经写成「dist 总量 - dist/config 总量」，而 dist/ 一层本来就不含 config，于是相减
 * 得到负数、断言永远成立——一条永远绿的检查比不做检查更坏，它让人以为有护栏。
 * @param relDir - 相对包根的目录
 * @returns 字节合计
 */
function jsBytesUnder(relDir: string, exclude: ReadonlySet<string> = new Set()): number {
  const dir = path.join(pkgDir, relDir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".js") && !exclude.has(name))
    .reduce((sum, name) => sum + readFileSync(path.join(dir, name)).byteLength, 0);
}

describe("dist 体积上限", () => {
  it("运行期切面总量在预算内", () => {
    const bytes = jsBytesUnder("dist", HOST_RUNTIME_EXCLUDE);
    assert.ok(
      bytes <= RUNTIME_BUDGET_BYTES,
      `运行期切面 ${bytes} B 超预算 ${RUNTIME_BUDGET_BYTES} B。若是关掉了 minify 请改回；` +
        "若确实需要变大，请改 test/dist-size.test.ts 的常量并写明理由。",
    );
  });

  it("客户端行在独立预算内", () => {
    const bytes = readFileSync(path.join(pkgDir, "dist", "client.js")).byteLength;
    assert.ok(
      bytes <= CLIENT_BUDGET_BYTES,
      `客户端行 ${bytes} B 超预算 ${CLIENT_BUDGET_BYTES} B；改预算前先确认没有把宿主运行期代码打进这条行。`,
    );
  });

  it("配置表总量在预算内", () => {
    const bytes = jsBytesUnder("dist/config");
    assert.ok(bytes <= CONFIG_BUDGET_BYTES, `配置面 ${bytes} B 超预算 ${CONFIG_BUDGET_BYTES} B。`);
  });

  it("构建编排切面总量在预算内", () => {
    const bytes = jsBytesUnder("dist/build");
    assert.ok(
      bytes <= BUILD_BUDGET_BYTES,
      `构建编排切面 ${bytes} B 超预算 ${BUILD_BUDGET_BYTES} B。` +
        "若数字主要来自陌生 chunk，先 node build-clean.mjs 清掉旧 dist/build 残留；确实是当期产物变大再改预算。",
    );
  });
});
