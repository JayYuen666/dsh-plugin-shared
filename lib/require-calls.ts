// lib/require-calls.ts —— 从产物 AST 里收集 `require(...)` / `require.async(...)` 调用。
//
// 为什么不再扫文本：`require("x")` 与正则字面量 `/require("x")/` 在字符层面同形，
// 注释、字符串、模板里也能出现同样的片段。按文本匹配会把不存在的外置依赖判成
// 「泄漏」，也会漏掉写成变量/拼接的调用。判据改成解析器交回的 AST 之后，只认真正的
// CallExpression，正则与注释里的同名片段天然不在集合里。
import { walkAst } from "./ast-walk.ts";
import { isArrayValue, isRecord } from "./record.ts";

/** 一次产物里 require 调用的可核对形态。 */
export interface RequireCallFacts {
  /** 字面 `require("…")` 的说明符（按出现顺序，可能重复）。 */
  readonly staticSpecifiers: readonly string[];
  /** 第一个实参不是字符串字面量的 `require(...)` 次数。 */
  readonly dynamicStaticCalls: number;
  /** 字面 `require.async("…")` 的说明符（按出现顺序，可能重复）。 */
  readonly asyncSpecifiers: readonly string[];
  /** 第一个实参不是字符串字面量的 `require.async(...)` 次数。 */
  readonly dynamicAsyncCalls: number;
}

/** `require(...)` 的两类调用。 */
type RequireKind = "static" | "async";

/** 判据要读的 AST 节点字段（全部按 unknown 读，逐处窄化）。 */
interface AstNode {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly computed?: unknown;
  readonly object?: unknown;
  readonly property?: unknown;
  readonly callee?: unknown;
  readonly arguments?: unknown;
  readonly quasis?: unknown;
  readonly expressions?: unknown;
  readonly cooked?: unknown;
}

/**
 * 把 isRecord 的结果收窄成判据用的节点视图。
 *
 * 不用 `Record<string, unknown>` 直接点号访问：索引签名在 `noPropertyAccessFromIndexSignature`
 * 下必须写括号，而括号又会被 dot-notation 规则拦；一份显式字段的视图两边都成立。
 * @param value - 待判定的值
 * @returns 节点视图；不是普通对象时为 undefined
 */
function astNodeOf(value: unknown): AstNode | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * 标识符节点的名字。
 * @param node - AST 节点
 * @returns 标识符名；其它节点为 undefined
 */
function identifierNameOf(node: unknown): string | undefined {
  const record = astNodeOf(node);
  const { name } = record ?? { name: undefined };
  return record?.type === "Identifier" && typeof name === "string" ? name : undefined;
}

/**
 * 无插值模板字面量的值（rolldown 压缩产物用反引号写字符串）。
 * @param node - TemplateLiteral 节点
 * @returns 字面量值；带插值或形状不符时为 undefined
 */
function templateValueOf(node: AstNode): string | undefined {
  const { expressions, quasis } = node;
  let literal: string | undefined;
  if (isArrayValue(expressions) && expressions.length === 0 && isArrayValue(quasis)) {
    const [element] = quasis;
    const { value } = astNodeOf(element) ?? { value: undefined };
    const { cooked } = astNodeOf(value) ?? { cooked: undefined };
    if (typeof cooked === "string") {
      literal = cooked;
    }
  }
  return literal;
}

/**
 * 字符串实参的值：普通字面量与无插值模板都算。
 * @param node - AST 节点
 * @returns 字符串值；其它节点为 undefined
 */
function stringLiteralOf(node: unknown): string | undefined {
  const record = astNodeOf(node);
  const { value } = record ?? { value: undefined };
  let literal: string | undefined;
  if (record?.type === "Literal" && typeof value === "string") {
    literal = value;
  } else if (record?.type === "TemplateLiteral") {
    literal = templateValueOf(record);
  }
  return literal;
}

/**
 * 这是一个 require 调用吗？只认 `require(...)` 与 `require.async(...)`；
 * `require.resolve(...)`、`obj.require(...)` 一类不算，避免把无关成员调用纳入判据。
 * @param callee - CallExpression 的 callee
 * @returns 调用种类；不是 require 调用时为 undefined
 */
function requireKindOf(callee: unknown): RequireKind | undefined {
  const node = astNodeOf(callee);
  let kind: RequireKind | undefined;
  if (identifierNameOf(callee) === "require") {
    kind = "static";
  } else if (
    node?.type === "MemberExpression" &&
    node.computed !== true &&
    identifierNameOf(node.object) === "require" &&
    identifierNameOf(node.property) === "async"
  ) {
    kind = "async";
  }
  return kind;
}

/**
 * 遍历 AST，收集 require 调用的字面与非字面形态。
 *
 * 结构遍历统一走 {@link walkAst}：防环、数组与记录下钻只有一份实现，解析器换实现时
 * 判据不需要跟着改名。
 * @param ast - 解析器交回的 Program
 * @returns 四类调用的统计与字面说明符
 */
export function collectRequireCalls(ast: unknown): RequireCallFacts {
  const staticSpecifiers: string[] = [];
  const asyncSpecifiers: string[] = [];
  let dynamicStaticCalls = 0;
  let dynamicAsyncCalls = 0;

  const recordRequire = (kind: RequireKind, args: readonly unknown[]): void => {
    const literal = stringLiteralOf(args.at(0));
    if (literal === undefined) {
      if (kind === "static") {
        dynamicStaticCalls += 1;
      } else {
        dynamicAsyncCalls += 1;
      }
      return;
    }
    if (kind === "static") {
      staticSpecifiers.push(literal);
    } else {
      asyncSpecifiers.push(literal);
    }
  };

  walkAst(ast, (node) => {
    const record = node as AstNode;
    const kind = record.type === "CallExpression" ? requireKindOf(record.callee) : undefined;
    if (kind !== undefined) {
      const args = isArrayValue(record.arguments) ? record.arguments : [];
      recordRequire(kind, args);
    }
    // 继续遍历：一次产物里的 require 调用可能有多条。
    return false;
  });

  return { staticSpecifiers, dynamicStaticCalls, asyncSpecifiers, dynamicAsyncCalls };
}
