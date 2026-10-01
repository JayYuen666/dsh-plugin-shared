// test/project-key.test.ts —— 项目桶键派生单测。
//
// 两条主断言分别钉住两个方向：
//   1. 兼容：绝对且已规范的路径，键与"纯字符串归一"的旧实现逐字节相同（存量桶不迁移，
//      与记忆网关 plugin/lib/workspace-peer.ts 的 agent_id 对照关系不破）；
//   2. 修复：相对路径 / `..` 冗余段 / 软链（macOS /tmp ↔ /private/tmp）归一到同一桶。
// realpath 经 opts 注入，测试不碰真实文件系统（node/no-sync 底线，也不依赖 runner 环境）。

import { describe, expect, it } from "vitest";
import path from "node:path";
import { createHash } from "node:crypto";
import { deriveProjectKey } from "../lib/project-key.ts";

/** 旧实现的键形态：只做字符串归一（trim + 折叠重复斜杠 + 去尾斜杠）后取哈希。 */
function legacyKey(cwd: string): string {
  const norm = cwd
    .trim()
    .replaceAll(/\/{2,}/gu, "/")
    .replace(/\/+$/u, "");
  const last = norm.slice(norm.lastIndexOf("/") + 1).replaceAll(/\s+/gu, "_");
  return `${last}-${createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 8)}`;
}

/** 恒等注入：只看字符串归一，不引入文件系统状态。 */
const noFs = { realpath: (target: string): string => target };

/** 字面量断言里重复出现的两个入参路径（同一条键的多次求值，不是两个不同用例）。 */
const DEV_PROJ_PATH = "/Users/dev/proj";
const TMP_SYMLINKED_PATH = "/tmp/x/proj";

describe("deriveProjectKey", () => {
  it("绝对已规范路径：与旧实现逐字节相同（存量桶不迁移）", () => {
    // 字面量断言：这两个串是跨系统契约的锚点，任何改动都会立刻红在这里。
    expect(deriveProjectKey(DEV_PROJ_PATH)).toBe("proj-75ff31d9");
    expect(deriveProjectKey("/repo/proj/src")).toBe("src-86c69f49");
    expect(deriveProjectKey(DEV_PROJ_PATH, noFs)).toBe(legacyKey(DEV_PROJ_PATH));
  });

  it("非字符串 / 空 / 根路径 → default", () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(deriveProjectKey(value, noFs)).toBe("default");
    }
    expect(deriveProjectKey("", noFs)).toBe("default");
    expect(deriveProjectKey("   ", noFs)).toBe("default");
    expect(deriveProjectKey("/", noFs)).toBe("default");
    expect(deriveProjectKey("///", noFs)).toBe("default");
  });

  it("重复斜杠 / 尾斜杠 / 空格目录名：归一不改桶，尾段空白转下划线", () => {
    expect(deriveProjectKey("/repo/proj//src///", noFs)).toBe(
      deriveProjectKey("/repo/proj/src", noFs),
    );
    expect(deriveProjectKey("/a/my repo/", noFs)).toBe(deriveProjectKey("/a/my repo", noFs));
    expect(deriveProjectKey("/a/my repo", noFs)).toMatch(/^my_repo-[0-9a-f]{8}$/u);
  });

  it("相对路径先 path.resolve：同一目录的两种写法同键", () => {
    expect(deriveProjectKey("proj", noFs)).toBe(deriveProjectKey(path.resolve("proj"), noFs));
    expect(deriveProjectKey("./proj/../proj", noFs)).toBe(deriveProjectKey("proj", noFs));
    expect(deriveProjectKey("proj", noFs)).toMatch(/^proj-[0-9a-f]{8}$/u);
  });

  it("realpath 成功：软链前缀折叠到真实目录（macOS /tmp ↔ /private/tmp）", () => {
    const viaSymlink = {
      realpath: (target: string): string => target.replace("/tmp/", "/private/tmp/"),
    };
    expect(deriveProjectKey(TMP_SYMLINKED_PATH, viaSymlink)).toBe(
      deriveProjectKey("/private/tmp/x/proj", noFs),
    );
    expect(deriveProjectKey(TMP_SYMLINKED_PATH, viaSymlink)).not.toBe(
      deriveProjectKey(TMP_SYMLINKED_PATH, noFs),
    );
  });

  it("realpath 抛错（ENOENT/EACCES）：退回 resolve 结果继续，不向上抛", () => {
    const hostile = {
      realpath: (): string => {
        throw new Error("EACCES: permission denied");
      },
    };
    expect(deriveProjectKey("/a/b/", hostile)).toBe("b-662b7b62");
    expect(deriveProjectKey("/a/b", hostile)).toBe(deriveProjectKey("/a/b", noFs));
  });

  it("同一 cwd 幂等（重复调用同键）", () => {
    expect(deriveProjectKey("/w/proj/backend", noFs)).toBe(
      deriveProjectKey("/w/proj/backend", noFs),
    );
  });
});
