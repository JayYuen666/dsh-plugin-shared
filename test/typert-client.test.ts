// test/typert-client.test.ts —— Typert 客户端骨架的单元判据。
//
// 收编的七个仓各自保留自己的行为用例（descriptor 对质、挂载缓存、失败路径）；这里
// 只钉骨架本体的守卫判据。parseOrThrow 同族的 zod 出口由各仓自持（暂缓收编，理由见
// lib/typert-client.ts 文件头）。
import { describe, expect, it } from "vitest";
import { isRemoteMounter } from "../lib/typert-client.ts";
import type { RemoteMounter } from "../lib/typert-client.ts";

describe("isRemoteMounter", () => {
  it("带 $mount 函数位的记录为真（数组、null、标量、缺位、非函数位全为假）", () => {
    const ok: RemoteMounter = { $mount: async () => ({}) };
    expect(isRemoteMounter(ok)).toBe(true);
    expect(isRemoteMounter({ $mount: () => Promise.resolve({}) })).toBe(true);
    expect(isRemoteMounter({ $mount: 42 })).toBe(false);
    expect(isRemoteMounter({})).toBe(false);
    expect(isRemoteMounter(null)).toBe(false);
    expect(isRemoteMounter(42)).toBe(false);
    expect(isRemoteMounter("remote")).toBe(false);
    expect(isRemoteMounter([ok])).toBe(false);
  });

  it("原型链上的 $mount 也算（cordis 服务对象把方法挂在原型上）", () => {
    const proto = { $mount: async () => ({}) };
    expect(isRemoteMounter(Object.create(proto))).toBe(true);
  });
});
