// test/require-calls.test.ts —— 产物 require 调用的 AST 判据。
//
// 这里用真解析器（rolldown 的 parseAst）而不是手写 AST 桩：判据要回答的正是
// 「真实解析器交回的节点形状里，哪些是 require 调用」。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseAst } from "rolldown/parseAst";
import { collectRequireCalls } from "../lib/require-calls.ts";

/**
 * 解析一段 JS 产物，供判据读取。
 * @param code - 产物正文
 * @returns 解析器交回的 Program
 */
function parse(code: string): unknown {
  return parseAst(code, { lang: "js" }, "probe.js");
}

/** 合成一个 ExpressionStatement 包住的节点。 */
const call = (value: Record<string, unknown>): Record<string, unknown> => ({
  type: "ExpressionStatement",
  expression: value,
});
/** 合成一次 require 调用；缺 arguments 字段用于覆盖形状不完整那一路。 */
const requireCall = (args?: readonly unknown[]): Record<string, unknown> =>
  args === undefined
    ? { type: "CallExpression", callee: { type: "Identifier", name: "require" } }
    : { type: "CallExpression", callee: { type: "Identifier", name: "require" }, arguments: args };
/** 合成一个 TemplateLiteral 节点；字段由调用方给出。 */
const template = (value: Record<string, unknown>): Record<string, unknown> => ({
  type: "TemplateLiteral",
  ...value,
});

describe("collectRequireCalls", () => {
  it("收集字面 require 与 require.async（含反引号与重复项）", () => {
    const facts = collectRequireCalls(
      parse('require("a"); require("a"); require.async("./x.js"); require.async(`./y.js`);'),
    );
    assert.deepEqual(facts.staticSpecifiers, ["a", "a"]);
    assert.deepEqual(facts.asyncSpecifiers, ["./x.js", "./y.js"]);
    assert.equal(facts.dynamicStaticCalls, 0);
    assert.equal(facts.dynamicAsyncCalls, 0);
  });

  it("非字面调用与缺参都计入动态（构建期无法核对说明符）", () => {
    const facts = collectRequireCalls(parse("require(name); require(); require.async(name);"));
    assert.deepEqual(facts.staticSpecifiers, []);
    assert.deepEqual(facts.asyncSpecifiers, []);
    assert.equal(facts.dynamicStaticCalls, 2);
    assert.equal(facts.dynamicAsyncCalls, 1);
  });

  it("require.resolve、计算属性与其它对象的 require 都不算 require 调用", () => {
    const facts = collectRequireCalls(
      parse('require.resolve("z"); require["async"]("./q.js"); obj.require("w");'),
    );
    assert.deepEqual(facts.staticSpecifiers, []);
    assert.deepEqual(facts.asyncSpecifiers, []);
    assert.equal(facts.dynamicStaticCalls, 0);
    assert.equal(facts.dynamicAsyncCalls, 0);
  });

  it("ast 形状不完整时按动态调用处理，不抛错", () => {
    // 解析器换实现时可能交出缺字段的节点（expressions/quasis/arguments 不在）；
    // 判据只承诺「读不懂就按动态处理」，不能把缺字段当成 0 条或直接抛。
    const interpolation = requireCall([
      template({ expressions: [{}], quasis: [{ value: { cooked: "a" } }] }),
    ]);
    const quasisNotArray = requireCall([template({ expressions: [], quasis: "not-array" })]);
    const missingExpressions = requireCall([template({ quasis: [{ value: { cooked: "a" } }] })]);
    const emptyQuasis = requireCall([template({ expressions: [], quasis: [] })]);
    const missingCooked = requireCall([template({ expressions: [], quasis: [{}] })]);
    const nonStringCooked = requireCall([
      template({ expressions: [], quasis: [{ value: { cooked: 42 } }] }),
    ]);
    const facts = collectRequireCalls({
      type: "Program",
      body: [
        call({ type: "CallExpression" }),
        call({ type: "CallExpression", callee: { type: "Identifier", name: "require" } }),
        call(interpolation),
        call(quasisNotArray),
        call(missingExpressions),
        call(emptyQuasis),
        call(missingCooked),
        call(nonStringCooked),
      ],
    });
    assert.deepEqual(facts.staticSpecifiers, []);
    assert.deepEqual(facts.asyncSpecifiers, []);
    assert.equal(facts.dynamicStaticCalls, 7);
    assert.equal(facts.dynamicAsyncCalls, 0);
  });

  it("撤销的 Proxy 不是 AST 节点：跳过而不是抛错", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const facts = collectRequireCalls(proxy);
    assert.deepEqual(facts, {
      staticSpecifiers: [],
      dynamicStaticCalls: 0,
      asyncSpecifiers: [],
      dynamicAsyncCalls: 0,
    });
  });
});
