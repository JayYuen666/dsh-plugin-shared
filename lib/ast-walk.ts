// lib/ast-walk.ts —— 解析器 AST 的公共结构遍历。
//
// 为什么存在：装饰器判据（decorator-lowering）与 require 调用收集（require-calls）原本各写
// 一份「seen 防环 + 数组递归 + 记录值下钻」的骨架。两份骨架对代理、数组与环的处理一旦漂移，
// 两条构建期判据就会对同一棵 AST 给出不同答案；这里只保留一份。
//
// 只做结构遍历，不依赖 oxc 的具体节点类名：调用方在 visitor 里按字段名判定。
// 递归用 `seen` 防环，解析器可能在节点上挂 parent 之类的反向引用。

import { isArrayValue, isRecord } from "./record.ts";

/** 访问一个 AST 记录节点；返回 `true` 表示已得出结论，后续节点不再访问。 */
export type AstVisitor = (node: Record<string, unknown>) => boolean | undefined;

/**
 * 遍历 AST：先访问记录节点本身，再按 `Object.values` 下钻；数组逐项下钻。
 *
 * 撤销后的 Proxy 既不是数组也不是记录，按「无节点」跳过，异常不冒泡。
 * 短路只保证不再访问后续节点：`Object.values` 会先把当前节点的值全部读出，
 * 同一节点上靠后的 getter 在第一个子节点被访问前就已执行（普通数据 AST 无此差异）。
 * @param ast - 整棵树的根节点；传子树时 `parent` 类反向引用会把遍历带出目标范围
 * @param visit - 记录节点的访问器；返回 true 时短路
 * @returns visitor 是否曾返回 true
 */
export function walkAst(ast: unknown, visit: AstVisitor): boolean {
  const seen = new Set<object>();
  const walk = (node: unknown): boolean => {
    if (node === null || typeof node !== "object" || seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (isArrayValue(node)) {
      for (const child of node) {
        if (walk(child)) {
          return true;
        }
      }
      return false;
    }
    if (!isRecord(node)) {
      // 撤销后的 Proxy 是唯一能走到这里的对象：typeof 仍报 object，两个守卫都拒绝它。
      return false;
    }
    if (visit(node) === true) {
      return true;
    }
    for (const child of Object.values(node)) {
      if (walk(child)) {
        return true;
      }
    }
    return false;
  };
  return walk(ast);
}
