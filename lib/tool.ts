// lib/tool.ts —— 工具侧单一入口。
//
// 宿主 / 工具侧代码只从这里取运行期件：`@jayyuen66/dsh-plugin-shared/tool`。
// 各模块仍各自产出 dist/<module>.js（构建期 entry / 测试用），但包 exports 不再暴露
// `./tool/<module>`；消费方只按这条 barrel 取。
//
// 为什么不把客户端件放进来：浏览器半只认 `./client` 那一条 UMD 行；把
// card-ui / typert-client 混进这里会让宿主侧 import 到浏览器实现。
export * from "./tool-events.ts";
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
export * from "./session-cwd.ts";
export * from "./number.ts";
export * from "./cli-safety.ts";
export * from "./remote-marker.ts";
export * from "./instance-lock.ts";
export * from "./skill.ts";
export * from "./placeholder.ts";
export * from "./session-projection.ts";
export * from "./with-timeout.ts";
