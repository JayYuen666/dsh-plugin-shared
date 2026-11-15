// lib/placeholder.ts 的单元测试：`{name}` 占位符插值的唯一一份实现。
//
// 判据围绕三条容易悄悄改坏的性质：
//   ① **缺值保留原文**——六个插件统一到这一条语义上，改回「替空串」会让所有写错占位符的
//      文案变成残句，而那种残句在单测里看不出来（文案表本身还是非空的）；
//   ② **不做二次解释**——替换进去的值若含 `{...}` 字形，不能被后续占位符再吃一遍
//      （源码行原文里 `${file}` 很常见）；
//   ③ **只认自有属性**——模板里写 `{toString}` 不能把函数插进文案。
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { fillPlaceholders } from "../lib/placeholder.ts";

describe("fillPlaceholders（{name} 插值）", () => {
  it("按名字替换：字符串与数字都原样插入", () => {
    assert.equal(
      fillPlaceholders("{count} 个文件，{path}", { count: 3, path: "/tmp/a" }),
      "3 个文件，/tmp/a",
    );
  });

  it("同一个占位符出现多次时每一处都替换", () => {
    assert.equal(fillPlaceholders("{tag}-{tag}-{tag}", { tag: "a" }), "a-a-a");
  });

  it("缺值时保留原文（不是空串）：写错的占位符要一眼可见", () => {
    assert.equal(
      fillPlaceholders("超出范围：{detail}", {}),
      "超出范围：{detail}",
      "六个插件统一成「保留原文」，改回空串会让这句塌成「超出范围：」",
    );
  });

  it("undefined 与没传同义保留原文；null 照实渲染成 null 字面量", () => {
    // 两者刻意不同：`exitCode: number | null` 这类形状里，null 是调用方明确交出来的值
    // （模板字符串 `${null}` 也渲染成 "null"），而 undefined 是「这个键压根没给」。
    assert.equal(
      fillPlaceholders("{alpha}|{beta}", { alpha: null, beta: undefined }),
      "null|{beta}",
    );
  });

  it("替换进去的值里的花括号不会被二次解释", () => {
    // 值的字形是源码行原文里常见的那种：`$` + 花括号。两边都用 String.raw，
    // 既避免模板串插值规则误报，也让期望值字面可读。
    const literal = String.raw`\${file}`;
    assert.equal(
      fillPlaceholders("{code} 与 {file}", { code: literal, file: "a.ts" }),
      `${literal} 与 a.ts`,
      "值里含占位符字形时必须原样保留：单趟替换，填充结果不回到扫描里",
    );
  });

  it("原型链上的同名成员不取（只认自有属性）", () => {
    assert.equal(fillPlaceholders("{toString}", {}), "{toString}");
    assert.equal(fillPlaceholders("{constructor}", {}), "{constructor}");
  });

  it("宽字形：键名可带点（`{gate.command}` 这类名字要能替换）", () => {
    // 六份旧实现里 quality-gate 的 `renderTemplate` 刻意支持带点的键，并有用例钉着；
    // 统一到这一份之后那条行为必须还在，否则工具名的点会被当成「不是占位符」。
    assert.equal(
      fillPlaceholders("{gate.command} 失败", { "gate.command": "pnpm check" }),
      "pnpm check 失败",
    );
  });

  it("宽字形下没提供的键同样保留原文（不塌成空串）", () => {
    assert.equal(
      fillPlaceholders("{outputName: path} 与 {path, content}", { outputName: "x" }),
      "{outputName: path} 与 {path, content}",
      "给人看的花括号不能被当成占位符吃掉",
    );
  });

  it("没有占位符时原样返回", () => {
    assert.equal(fillPlaceholders("一句没有占位符的文案", { a: "1" }), "一句没有占位符的文案");
  });
});
