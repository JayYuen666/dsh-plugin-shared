// test/session-projection.test.ts —— 新旧两代注册协议判别件的单元判据。
//
// 判序（先 handle 后 disposer）与「可调用性不当 handle 排除条件」这两条承重语义由
// lib/session-projection.ts 文件头与消费仓（danger-guard fail-open / session-rescue
// fail-fast）各自的行为用例共同覆盖；这里钉判别函数本身的四类输入。
import { describe, expect, it } from "vitest";
import {
  discriminateProjection,
  isDisposer,
  isProjectionHandle,
} from "../lib/session-projection.ts";
import type { ProjectionHandle } from "../lib/session-projection.ts";

const handle: ProjectionHandle = {
  stateOf: () => null,
  dispose: () => Promise.resolve(),
};

describe("discriminateProjection", () => {
  it("handle（对象）与 handle（可调用的合成值，可调用性不是排除条件）都判 handle", () => {
    expect(discriminateProjection(handle)).toBe("handle");
    // 可调用 + 带 stateOf/dispose 的合成值：判序把它送进新读口，而不是旧协议的双参 stateOf。
    const callable = Object.assign(() => null, handle);
    expect(discriminateProjection(callable)).toBe("handle");
  });

  it("disposer（纯函数）判 disposer", () => {
    expect(discriminateProjection(() => null)).toBe("disposer");
  });

  it("null、缺方法的对象、只带单边方法的形状判 null（处置归调用方）", () => {
    expect(discriminateProjection(null)).toBeNull();
    expect(discriminateProjection({})).toBeNull();
    expect(discriminateProjection({ dispose: () => Promise.resolve() })).toBeNull();
    expect(discriminateProjection({ stateOf: () => null })).toBeNull();
  });

  it("谓词与判别函数同判据", () => {
    expect(isProjectionHandle(handle)).toBe(true);
    expect(isDisposer(() => null)).toBe(true);
    expect(isProjectionHandle(() => null)).toBe(false);
    expect(isDisposer(handle)).toBe(false);
  });
});
