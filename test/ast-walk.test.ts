// lib/ast-walk 单元测试：结构遍历、短路、数组下钻、环与撤销 Proxy。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { walkAst } from "../lib/ast-walk.ts";

describe("walkAst", () => {
  it("先访问记录节点，再按对象值下钻；visitor 返回 true 时短路", () => {
    const visited: unknown[] = [];
    const ast = {
      first: [{ type: "hit" }],
      second: { type: "later" },
    };
    const hit = walkAst(ast, (node) => {
      visited.push(node["type"]);
      return node["type"] === "hit";
    });
    assert.equal(hit, true);
    // 根节点先访问（无 type），随后进入 first 数组的第一项；second 没被访问。
    assert.deepEqual(visited, [undefined, "hit"]);
  });

  it("visitor 一直返回 false 时遍历完整棵树，并返回 false", () => {
    const seen: string[] = [];
    const ast = [{ type: "a" }, { type: "b" }];
    const hit = walkAst(ast, (node) => {
      if (typeof node["type"] === "string") {
        seen.push(node["type"]);
      }
      return false;
    });
    assert.equal(hit, false);
    assert.deepEqual(seen, ["a", "b"]);
  });

  it("环不会重复访问，父引用也按同一份 seen 剪枝", () => {
    const root: Record<string, unknown> = { type: "root" };
    root["parent"] = root;
    root["child"] = { type: "child", parent: root };
    let count = 0;
    assert.equal(
      walkAst(root, () => {
        count += 1;
        return false;
      }),
      false,
    );
    assert.equal(count, 2);
  });

  it("撤销后的 Proxy 不抛穿：按无节点跳过", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.equal(
      walkAst(proxy, () => true),
      false,
    );
  });

  it.each([
    ["对象", {}],
    ["数组", []],
  ] as const)("撤销后的%s Proxy 作为兄弟节点：跳过它，后续节点照常访问", (_label, target) => {
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    const visited: unknown[] = [];
    const hit = walkAst({ broken: proxy, later: { type: "later" } }, (node) => {
      visited.push(node["type"]);
      return node["type"] === "later";
    });
    assert.equal(hit, true);
    // 只访问根与 later 各一次：代理没进 visitor，也没有异常冒出来。
    assert.deepEqual(visited, [undefined, "later"]);
  });

  it("null 与原始值直接跳过", () => {
    assert.equal(
      walkAst(null, () => true),
      false,
    );
    assert.equal(
      walkAst("not-an-ast", () => true),
      false,
    );
    assert.equal(
      walkAst(42, () => true),
      false,
    );
  });
});
