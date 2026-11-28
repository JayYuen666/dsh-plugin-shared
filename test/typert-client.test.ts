// test/typert-client.test.ts —— Typert 客户端骨架的单元判据。
//
// 收编的各消费仓分别保留自己的行为用例（descriptor 对质、挂载缓存、失败路径）；这里
// 只钉骨架本体的守卫判据。parseOrThrow 的 zod 出口由各仓自持：这里用假 schema 固定
// describe 注入与 TypeError 语义，不引 zod。
import { describe, expect, it } from "vitest";
import { isRemoteMounter, parseOrThrow, remoteMounterOf } from "../lib/typert-client.ts";
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

describe("remoteMounterOf", () => {
  it("缺省 strict=false；显式 true 会传给 ctx.get", () => {
    let seen: boolean | undefined;
    const mounter = { $mount: async () => ({}) };
    const ctx = {
      get: (_name: string, strict?: boolean) => {
        seen = strict;
        return mounter;
      },
    };
    expect(remoteMounterOf(ctx)).toBe(mounter);
    expect(seen).toBe(false);
    expect(remoteMounterOf(ctx, true)).toBe(mounter);
    expect(seen).toBe(true);
  });

  it("ctx 缺席、get 缺席、形状不符都回 undefined", () => {
    expect(remoteMounterOf(undefined)).toBeUndefined();
    expect(remoteMounterOf({})).toBeUndefined();
    expect(remoteMounterOf({ get: () => ({}) })).toBeUndefined();
    expect(remoteMounterOf({ get: () => 1 })).toBeUndefined();
  });

  it("ctx.get 抛错按「没有远程通道」处理，不打断卡片装配", () => {
    expect(
      remoteMounterOf({
        get: () => {
          throw new Error("服务尚未就绪");
        },
      }),
    ).toBeUndefined();
  });
});

describe("parseOrThrow", () => {
  const schema = {
    safeParse(value: unknown): { success: true; data: number } | { success: false; error: Error } {
      return value === 42
        ? { success: true, data: 42 }
        : { success: false, error: new Error("bad") };
    },
  };

  it("成功取 data；失败抛 TypeError，文本来自注入的 describe", () => {
    expect(parseOrThrow(schema, 42, () => "unused")).toBe(42);
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- 这里测的正是「回调作 describe」的失败路径
    expect(() => parseOrThrow(schema, "x", (error) => error.message)).toThrow(TypeError);
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- 同上
    expect(() => parseOrThrow(schema, "x", (error) => error.message)).toThrow("bad");
  });
});
