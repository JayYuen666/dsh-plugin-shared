// test/log-templates.ts —— 本包操作者可见日志的模板片段，**手工维护**。
//
// 记录清单用它判断「这条日志是不是源码里现存的模板」；新增 console.* 若没有对应片段，
// 跑测时那条日志就会被判未认领（见 test/setup-logs.ts）。这里不读盘：规则面
// （node/no-sync 等）不该为了测试脚手架开口子，且模板变化应当是一次显式的改动。
//
// 两边的双向校验在 test/log-templates.test.ts：往源码里加一条 console.* 后**必须**回来补一行，
// 删掉一条日志后**必须**回来删掉对应片段——两个方向都有用例判失败，漏一边都会在跑测时指出。
//
// `Object.freeze` 不是多余：`readonly string[]` 只是编译期约束，运行期照样 push 得动，
// 而记录清单一旦被测试中途改过，后续用例的认领判断就跟着变了。
export const LOG_TEMPLATES: readonly string[] = Object.freeze([
  "[shared/lesson-bus] onFailure threw:",
  "释放 rolldown bundle 失败（不影响上面那条构建错因）:",
]);
