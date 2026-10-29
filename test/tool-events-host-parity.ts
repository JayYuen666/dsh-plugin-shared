// test/tool-events-host-parity.ts —— 编译期断言：本地 PTC 载荷声明与开发基线宿主包的定义仍同形。
//
// 为什么要有这一条：lib/tool-events.ts 自己声明两个 PTC 载荷并自己做 `SessionEventMap` 增强
//（理由见该文件头），于是"宿主改了字段而本地副本没跟上"不再是编译错误，而是静默的字段误读。
// 这里把漂移变回编译错误：双向可赋值任一方向不成立，`MutuallyAssignable` 就折成 `false`，
// 下面两行 `= true` 过不了 `pnpm typecheck`。
//
// ⚠ 判据只由 **tsc** 兑现，不由 vitest 兑现：类型在运行期已被擦除，任何把它包成 `it()` 的写法
// 都会恒真通过（实测：把 `meta?: JsonValue` 改成 `meta?: string`，tsc 报 TS2322，而 vitest 那条
// 用例照样 1 passed）。所以本文件刻意**不是** `.test.ts`——它没有可执行内容，只有类型面。
// 同一次实验也证明：两份同 key 的增强即使字段已经漂移也**不报** TS2717，别把它当成第二处检测。
//
// 导入路径随**开发基线**走：基线能提供 `@deepseek-ai/dsh-tool-executor-ptc/types` 时用它；
// 换到不提供该包的基线时，这条导入与那枚 devDependency 一起改到当期的宿主出处。只在测试面，
// 不进发布产物（tsconfig.build.json 的 include 只有 lib/**）。

import type { PtcDispatchEventData, PtcDispatchStartEventData } from "../lib/tool-events.ts";
import type {
  PtcDispatchEventData as HostPtcDispatchEventData,
  PtcDispatchStartEventData as HostPtcDispatchStartEventData,
} from "@deepseek-ai/dsh-tool-executor-ptc/types";

/** 两个类型是否互为可赋值；任一方向不成立即 `false`。 */
type MutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

/** 导出即被 tsc 检查；运行期无人调用它。 */
export const ptcStartParity: MutuallyAssignable<
  PtcDispatchStartEventData,
  HostPtcDispatchStartEventData
> = true;

/** 导出即被 tsc 检查；运行期无人调用它。 */
export const ptcSettleParity: MutuallyAssignable<PtcDispatchEventData, HostPtcDispatchEventData> =
  true;
