// lib/index.ts —— @jayyuen66/dsh-plugin-shared 的根入口 barrel。
//
// 消费方按裸包名子路径取用：宿主/工具侧走 `@jayyuen66/dsh-plugin-shared/tool`，浏览器侧走
// `.../client`，不要用 `../shared/...`——包一旦被装进 node_modules 就不再与本包相邻，相对路径会
// 让整片插件加载失败。根入口自身只用于让 Loader 能把本包当作一个插件行装载，不是消费方的主要
// 取用面；它保留仍未从根入口迁移走的公共模块，客户端专用的 `card-ui` 与只经子路径取用的模块
// 刻意不进（清单与理由见 test/index.test.ts 的 BARREL_EXEMPT）。
//
// 模块清单需要手工同源的有五处：本 barrel、`lib/tool.ts` 工具侧 barrel、`lib/client-entry.ts`
// 客户端 barrel、build-host.mjs 的 `facets` / `entries` 数组，以及 package.json 的 `exports`。
// 一致性都有测试固定：barrel↔lib 由 test/index.test.ts、exports↔lib 由 test/publish-manifest.test.ts、
// facets↔lib 由 test/build-host.test.ts。tsconfig.build.json 用 `lib/**/*.ts` glob 收程序面，
// 不需要逐模块维护。

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
export * from "./path-scope.ts";
export * from "./value.ts";
export * from "./card-form.ts";
export * from "./session-cwd.ts";
export * from "./number.ts";
export * from "./cli-safety.ts";
