// test/tool-events-message-keys.ts —— `tool/result.message` 字段名的编译期断言。
//
// `lib/tool-events.ts` 把 message 按 `unknown` 读（重放/跨进程边界送来的坏形状不在类型声明
// 内），代价是官方字段改名不会在运行期之前暴露：`message.source.callId` 与
// `message.isError` 都只是字符串索引。这个文件把两个名字钉到官方 `ToolResultMessage` 上，
// 字段被挪走/改名时 tsc 先在 shared 自己的 typecheck 报错，而不是让消费方静默读成
// undefined（那会把失败当成功，或让结算永远配不上调用）。
//
// 本文件不跑测试，只由 `tsc --noEmit -p tsconfig.json` 兑现（test/**/*.ts 在 include 里）。
import type { ToolResultMessage } from "@deepseek-ai/dsh-llm";

type Assert<Value extends true> = Value;

type SourceCallId = ToolResultMessage["source"]["callId"];
type IsError = ToolResultMessage["isError"];

/** 外层的 `source.callId` 必须仍是字符串（官方 `ToolCallId`，运行期就是 string）。 */
export type SourceCallIdIsString = Assert<SourceCallId extends string ? true : false>;

/** `isError` 必须仍是“可选 boolean”；缺省按成功、非布尔按坏形状是 shared 的读法前提。 */
export type IsErrorIsOptionalBoolean = Assert<IsError extends boolean | undefined ? true : false>;
