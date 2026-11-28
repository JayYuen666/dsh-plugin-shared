// lib/value.ts —— unknown → 文本/正则片段的零依赖转换。
//
// 为什么单独一枚：`strOf`/`textOf`/`str` 这一族在各包里原本有 7 份实现，分两派语义：
//   - 只认字符串（非字符串给空串）；
//   - 字符串、number、boolean 都转 String，其余给空串。
// 两派不能合成一个函数：把 number 折成字符串会让「只认字符串」的调用点静默接受类型错，
// 而把 number 拒掉又会让展示层丢掉合法的数值读数。故这里给两个名字，由调用点自己选。
//
// 本文件零依赖，客户端与宿主都能取；不要再把这类转换塞进 `lib/text.ts`——那个模块值导入
// `@deepseek-ai/dsh-output-retention`，客户端一旦从 `lib/text` 取本函数，会把宿主 peer
// 拖进浏览器 bundle。

/**
 * 未知值 → 安全字符串：只认字符串，其余一律空串。
 *
 * 不 trim、不把 number/boolean 折成文本：这两件事分别是调用点的语义（见文件头）。
 * @param value - 待转换的值
 * @returns 原字符串，或空串
 */
export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 未知值 → 展示字符串：字符串原样，number/boolean 用 `String()`，其余空串。
 *
 * 不接受 bigint/symbol/对象：对象走 `String()` 会得到 `[object Object]`，把它塞进模型
 * 可见的读数只会制造噪音；bigint 与 symbol 也不是设置卡的值域。
 * @param value - 待转换的值
 * @returns 可展示的文本，或空串
 */
export function asDisplayText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * 把一段字面量转成能安全拼进正则的形式。
 *
 * 字符集与 lodash 的 `escapeRegExp` 同义，但这里只做字面转义，不做 `RegExp` 构造；
 * 调用点负责加锚点与 flags。`/` 不转义——它只在正则字面量里有语法意义，`RegExp`
 * 构造器与 `replaceAll` 都不需要。
 * @param literal - 任意字面量
 * @returns 可嵌进正则源码的片段
 */
export function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}
