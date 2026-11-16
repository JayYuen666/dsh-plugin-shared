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

/** 运行期产物预算（在实测值上加一档取整）。消费方按子路径 external 取用，这些字节是真实装载成本。
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
 *  以及三个消费仓的 `lib/skill.ts` 薄壳（它们只转发 `ctx`，无需改）。 */
const RUNTIME_BUDGET_BYTES = 37_800;
/** 客户端行预算：dist/client.js 由浏览器加载，不计入宿主运行期预算。
 *  压缩前历史读数 54,765 → 54,878 → 54,925 → 57,139 B，涨幅来自 card-ui 样式与注入兜底；
 *  这些改动的说明仍在 `lib/card-ui/styles.ts` 与 CHANGELOG。shared 自己的 build-client.mjs
 *  现在显式传 `minify: true`，当前实测 27,087 B（gzip 7,906 B），预算按实测值取整留一档。
 *  宿主侧子路径（`skill` / `placeholder`）不进这条 bundle。
 *  受影响的公共面：无（常量只在本用例内）；同步面：README 的 "What ships"。 */
const CLIENT_BUDGET_BYTES = 28_000;
/** 宿主运行期不装载客户端 bundle：UMD 由模块图在浏览器侧按行提供，ESM 只是 Node 测试与类型声明的入口。 */
const HOST_RUNTIME_EXCLUDE = new Set(["client.js", "client-entry.js"]);
/** 配置产物预算（在实测值上加一档取整）。构建期才加载，但整个 dist 都在 files 白名单里，一并计入 tarball。
 *  客户端行的测试别名（shared/client → shared/client-node）把配置产物推到 30064 B，按同一 +25% 规则抬到 31000 B。 */
const CONFIG_BUDGET_BYTES = 31_000;
/** 构建编排产物预算（dist/build/，各包 build-*.mjs 构建期取用）。与配置产物同一记录理由：
 *  不占插件运行期装载成本，但整目录随 tarball 发布。 */
const BUILD_BUDGET_BYTES = 22_000;

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
      `构建编排切面 ${bytes} B 超预算 ${BUILD_BUDGET_BYTES} B。`,
    );
  });
});
