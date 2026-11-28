// build-clean 的回归：
// 1) 清理必须覆盖整棵 dist（含 types/config/build 这些没有自清理逻辑的面）；
// 2) 失败必须只报告一次并以非零退出，不能吞成成功；
// 3) 完整构建的第一条命令必须是清理，不能再依赖 prebuild 这种生命周期约定。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cleanDist, runClean } from "../build-clean.mjs";

const DIST = "dist";
const CLEANED = "dist cleaned:";
const CLEAN_FAILED = "dist 清理失败:";
const INFO = "info:";
const ERROR = "error:";
const EPERM = "EPERM: operation not permitted";
const BUILD_CLEAN = "node build-clean.mjs && ";

/** 建一个临时目录；用例的 finally 负责删除。 */
async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "dsh-build-clean-"));
}

/** 取首条日志；空数组在这里就是用例失败，不把 undefined 带进后续断言。 */
function firstCall(calls: readonly string[]): string {
  const [first] = calls;
  assert.ok(first !== undefined, "日志为空");
  return first;
}

describe("build-clean", () => {
  it("删除整棵产物树（含 types/config/build 与顶层文件）", async () => {
    const root = await scratch();
    try {
      const dist = path.join(root, DIST);
      await mkdir(path.join(dist, "types", "card-ui"), { recursive: true });
      await mkdir(path.join(dist, "config"), { recursive: true });
      await mkdir(path.join(dist, "build"), { recursive: true });
      await writeFile(path.join(dist, "tool.js"), "js");
      await writeFile(path.join(dist, "types", "card-ui", "field.d.ts"), "dts");
      await writeFile(path.join(dist, "config", "oxlint.base.js"), "cfg");
      await writeFile(path.join(dist, "build", "build-host.js"), "build");
      await cleanDist(dist);
      await assert.rejects(stat(dist), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("目录不存在时成功（force 只忽略 ENOENT）", async () => {
    const root = await scratch();
    try {
      const target = path.join(root, DIST);
      await cleanDist(target);
      await assert.rejects(stat(target), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("非 ENOENT 错误必须向调用方传播，不得吞成成功", async () => {
    // 含空字节的路径会被 rm 以 ERR_INVALID_ARG_VALUE 拒绝；这不是 ENOENT，force 不得吞掉。
    // 用参数错误而不是 chmod：后者在 Windows 上不成立，这条用例要三格矩阵都能跑。
    await assert.rejects(cleanDist("\0"), { code: "ERR_INVALID_ARG_VALUE" });
  });

  it("清理失败只报告一次并以 1 退出，成功才打印 cleaned", async () => {
    const calls: string[] = [];
    const log = {
      info: (...args: unknown[]) => {
        calls.push(`${INFO}${args.join(" ")}`);
      },
      error: (...args: unknown[]) => {
        calls.push(`${ERROR}${args.join(" ")}`);
      },
    };
    const failed = await runClean({
      clean: () => Promise.reject(new Error(EPERM)),
      log,
    });
    assert.equal(failed, 1);
    assert.equal(calls.length, 1);
    const failure = firstCall(calls);
    assert.ok(failure.startsWith(`${ERROR}${CLEAN_FAILED}`), "失败行必须是 error:dist 清理失败:");
    assert.ok(failure.includes(EPERM), "失败行必须带上原始错误消息");
    assert.ok(!calls.some((line) => line.startsWith(INFO)), "失败时不得打印 cleaned");

    calls.length = 0;
    const ok = await runClean({ clean: () => Promise.resolve(), log });
    assert.equal(ok, 0);
    assert.equal(calls.length, 1);
    const success = firstCall(calls);
    assert.ok(success.startsWith(`${INFO}${CLEANED}`), "成功行必须是 info:dist cleaned:");
    assert.ok(!calls.some((line) => line.startsWith(ERROR)), "成功时不得打印失败行");
  });

  it("完整构建的第一条命令是清理，且不再依赖 prebuild", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as unknown as { scripts?: Record<string, string> };
    const build = manifest.scripts?.["build"] ?? "";
    assert.ok(build.startsWith(BUILD_CLEAN), "build 必须从 node build-clean.mjs 开始");
    assert.equal(
      manifest.scripts?.["prebuild"],
      undefined,
      "prebuild 已折进 build，不能再有第二份接线",
    );
  });
});
