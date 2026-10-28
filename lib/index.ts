// lib/index.ts —— @jayyuen66/dsh-plugin-shared 入口：tool 事件流记录的公共逻辑 +
// 客户端卡片 apply 与差异比较的公共实现 + 项目键生成 + 代理对安全截断。消费方一律按裸包名子路径取
// （`@jayyuen66/dsh-plugin-shared/lib/record`），不用 `../shared/...`：包一旦被装进
// node_modules 就不再与本包相邻，相对路径会整片插件加载失败。
//
// 模块清单有四份同源记录：本 barrel、build-host.mjs 的 `facets` 数组、package.json 的
// `exports`、tsconfig.build.json 的 glob include（自维护）。四处的一致性都有测试固定，
// 新增/删除模块后四条检查各管一处：barrel↔lib 由 test/index.test.ts、exports↔lib 由
// test/publish-manifest.test.ts、facets↔lib 由 test/build-host.test.ts。

export * from "./tool-events.ts";
export * from "./card-apply.ts";
export * from "./card-diff.ts";
export * from "./project-key.ts";
export * from "./locale.ts";
export * from "./lesson-bus.ts";
export * from "./text.ts";
export * from "./record.ts";
export * from "./errors.ts";
export * from "./jsonl.ts";
export * from "./job-outcome.ts";
