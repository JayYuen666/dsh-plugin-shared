// test/tool-events-ptc-keys.ts —— PTC 官方增补载入判据（编译期，由 tsc 兑现，vitest 不执行）。
//
// lib/tool-events.ts 自本版起 re-export 官方 PTC 载荷并依赖官方包自带的 SessionEventMap
// 增补（换包窗口的裁决见该文件头）；原 test/tool-events-host-parity.ts 随之删除——两侧
// 是同一类型后双向可赋值断言恒真。本文件钉的是另一件事：联合里仍含这两个键。官方把增补
// 挪走、或 import 侧增补未载入时，satisfies 在 shared 自己的 typecheck 先于任何消费方红
// 出来（re-export 本身断没断，由 lib/tool-events.ts 自己的 import 行兑现）。
import type { SessionEventMap } from "@deepseek-ai/dsh-session/types";

const keys = [
  "tool/ptc-dispatch-start",
  "tool/ptc-dispatch",
] as const satisfies readonly (keyof SessionEventMap)[];

export { keys };
