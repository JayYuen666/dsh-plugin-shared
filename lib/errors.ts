// lib/errors.ts —— 把 `unknown` 的错误归一成界面可显示的文本。
//
// 语义对齐官方 `@deepseek-ai/dsh-llm` 的 `errorChain`，但本地实现而不依赖它。
// 不依赖的理由是实测的，不是偏好：本文件的调用点包含 client 半，而宿主把 dsh-llm
// 整包拖进浏览器产物时，rolldown 在 platform:"browser" 下即便强制 moduleSideEffects:false
// 也仍是 160,105 B（八个模块：zod 59,661 + schemastery 55,693 + dsh-llm 自身 22,957…），
// 且残留一个浏览器解析不了的 node:module；改成动态 import 只是把它推迟成同样大的异步块。
// 官方自己也不这么做——packages/client/* 对 dsh-llm 一律 import type，零值导入。
//
// 下面五条**就是官方 `errorChain` 自己的语义**，本文件逐条对齐（packages/llm/llm/src/error.ts
// 的同名函数，与这里的 render 逐行同构）。写成"相对『单层 message』多出的"会误导：读的人会
// 以为上游缺这五条能力，于是既不查官方件，也不推动上游收敛。
//   1. cause 链：`new Error("外", { cause: inner })` 渲染成 "外: 内"；
//   2. AggregateError 的成员以 `[e1; e2]` 附在 message 之后；
//   3. message 为空串时回退 Error.name，否则界面只拿到一个空字符串；
//   4. 非 Error 但带可读 message 属性的值取该属性，不靠 instanceof——跨 realm 的 Error
//      正是这种形状，此时 instanceof 恒为 false。**这改变了跨 realm 的渲染**：
//      另一个 realm 造的 Error 从 "Error: boom" 变成 "boom"。
//   5. 敌意的 getter 或 toString 抛错时降级为占位文本，绝不把异常从这里抛出去。
//
// 收录依据：本仓多个包里逐字同形的 messageOf/errorText 各有一份实现。
// 刻意不含三件异形件，它们的兜底值就是各自语义，合并即改行为：
//   quality-gate/host.ts 的 messageOf —— 非 Error 走 "unknown error"，不是 String(error)；
//   ctx-observe/host.ts 的 describeError —— 多一层 try，防 String() 自己抛；
//   session-rescue/host.ts 的 errorText —— 同名但读 message 的方式不同，不吃 instanceof。
//
// 本文件不碰文件、不读环境变量、不发外部请求。

/** 取对象**自有**的 message 属性；不是可读字符串则回 undefined。 */
function ownMessage(value: object): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, "message");
  // 单一 return：本仓 lint 开了 consistent-return 且 treatUndefinedAsUnspecified，
  // 与带值 return 混写的 `return undefined` 会被判红。
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

/** 渲染一个值，沿 cause 链递归；环上回访降级为占位文本。 */
function render(value: unknown, path: Set<unknown>): string {
  if (path.has(value)) {
    return "<circular cause>";
  }
  path.add(value);
  try {
    if (!(value instanceof Error)) {
      // 跨 realm 的 Error 走这一支：instanceof 判不出来，但它确实是带 message 的对象。
      if (typeof value === "object" && value !== null) {
        const owned = ownMessage(value);
        if (owned !== undefined) {
          return owned;
        }
      }
      return String(value);
    }
    const message = value.message === "" ? value.name : value.message;
    const members =
      value instanceof AggregateError && value.errors.length > 0
        ? ` [${value.errors.map((member) => render(member, path)).join("; ")}]`
        : "";
    const causeText =
      value.cause === undefined || value.cause === null ? "" : render(value.cause, path);
    // 包装层常写成 new Error(String(cause), { cause })，把 cause 再渲染一遍只是噪声。
    const cause = causeText === "" || causeText === message ? "" : `: ${causeText}`;
    return `${message}${members}${cause}`;
  } catch {
    // 敌意的 toString、message/name/cause/errors getter：这份文本要进界面通知与日志，
    // 任何东西都不能从这里逃出去。内层帧各自捕获自己的抛错，只塌掉出错的那一节。
    return "<unrenderable value>";
  } finally {
    // 只删当前这一节：菱形共享的同一个 cause 在另一条支路上仍能被完整渲染。
    path.delete(value);
  }
}

/**
 * 把捕获到的值渲染成一段人读文本。
 * `Error` 取 message（空串时回退 name）并接上 cause 链；`AggregateError` 附上成员；
 * 非 Error 但带可读 message 属性的取该属性，其余按 `String()` 兜底。
 * 全程不抛异常：敌意输入降级为占位文本。
 * @param error - 捕获到的值（catch 里的 `unknown`）。
 * @returns 可直接进界面通知或日志的文本。
 */
export function errorText(error: unknown): string {
  return render(error, new Set<unknown>());
}
