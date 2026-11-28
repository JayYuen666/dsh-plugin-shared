// test/session-cwd.test.ts —— 会话当前工作区的唯一读取口径。
//
// 活目录优先是承重的：宿主 `cd` 之后只有 workingDirectory 会跟着变，
// `session.header.cwd` 是建会话时的快照。服务缺席/给不出非空串时才回落后者。

import { describe, expect, it } from "vitest";
import {
  isWorkingDirectory,
  isWorkingDirectoryService,
  sessionWorkingDirectory,
} from "../lib/session-cwd.ts";

describe("working directory guards", () => {
  it("宽松判据允许 get 缺席，严格判据要求 get 在场", () => {
    expect(isWorkingDirectory({})).toBe(true);
    expect(isWorkingDirectoryService({})).toBe(false);
    const service = { get: () => "/live" };
    expect(isWorkingDirectory(service)).toBe(true);
    expect(isWorkingDirectoryService(service)).toBe(true);
    expect(isWorkingDirectoryService({ get: 1 })).toBe(false);
  });
});

describe("sessionWorkingDirectory", () => {
  it("没有 agent、没有 session 时为 undefined", () => {
    expect(sessionWorkingDirectory(undefined)).toBeUndefined();
    expect(sessionWorkingDirectory({})).toBeUndefined();
    expect(sessionWorkingDirectory({ session: {} })).toBeUndefined();
  });

  it("活目录优先于 header.cwd", () => {
    const agent = {
      session: { header: { cwd: "/snapshot" } },
      ctx: {
        get: (name: string) => (name === "workingDirectory" ? { get: () => "/live" } : undefined),
      },
    };
    expect(sessionWorkingDirectory(agent)).toBe("/live");
  });

  it("服务缺席、get 缺席或 get 不是函数时回落 header.cwd", () => {
    expect(
      sessionWorkingDirectory({
        session: { header: { cwd: "/snapshot" } },
        ctx: { get: () => ({}) },
      }),
    ).toBe("/snapshot");
    expect(
      sessionWorkingDirectory({
        session: { header: { cwd: "/snapshot" } },
        ctx: { get: () => ({ get: 1 }) },
      }),
    ).toBe("/snapshot");
  });

  it("活目录给空串或非字符串时回落，不把空值当成有效工作区", () => {
    for (const live of ["", 42, null]) {
      const agent = {
        session: { header: { cwd: "/snapshot" } },
        ctx: { get: () => ({ get: () => live }) },
      };
      expect(sessionWorkingDirectory(agent)).toBe("/snapshot");
    }
  });

  it("header.cwd 缺失或非字符串时 undefined", () => {
    expect(sessionWorkingDirectory({ session: { header: {} } })).toBeUndefined();
    expect(sessionWorkingDirectory({ session: { header: { cwd: 42 } } })).toBeUndefined();
    expect(sessionWorkingDirectory({ session: { header: { cwd: "" } } })).toBeUndefined();
    expect(sessionWorkingDirectory({ session: { header: { cwd: "/snapshot" } } })).toBe(
      "/snapshot",
    );
  });
});
