// test/project-key.test.ts —— 项目桶键派生单测。
//
// 两条主断言分别钉住两个方向：
//   1. 兼容：绝对且已规范的路径，键与"纯字符串归一"的旧实现逐字节相同（存量桶不迁移，
//      与记忆网关对照用的 agent_id 关系不破）；
//   2. 修复：相对路径 / `..` 冗余段 / 软链（macOS /tmp ↔ /private/tmp）归一到同一桶。
// realpath 与 sep 都经 opts 注入，测试不碰真实文件系统（node/no-sync 底线，也不依赖 runner
// 环境）。`sep` 现在定的是整条臂（字形 + 解析），所以 POSIX 与 Windows 两条臂在任一 runner
// 上都同样可判定——只注入字形时，POSIX 那几条在 Windows runner 上会拿到拼过 cwd 的原生解析
// 结果，字面量键当场漂移（实测 windows-latest 四条红）。

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

/**
 * 恒等 realpath + POSIX 那一侧的整条臂。字面量键锚的是消费方在 POSIX 上落下的桶，
 * 所以判据必须显式要 POSIX 解析，否则 runner 一换平台就不是同一件事了。
 */
const posixKey = { ...noFs, sep: path.posix.sep };

/**
 * Windows 形态的路径按 `path.win32.sep` 拼，不写反斜杠字面量：字面量要么满屏转义、
 * 要么走 `String.raw`，而后者在本仓类型引擎里算未知成员。用平台自己的常量还顺带说明
 * 「这就是 Win32 的分隔符」，比一串 `\\\\` 更贴近被判定的那件事。
 */
function winPath(...segments: string[]): string {
  return segments.join(path.win32.sep);
}

/** Windows 那一侧的整条臂：恒等 realpath + win32 字形与解析。 */
const winKey = { ...noFs, sep: path.win32.sep };

/** 字面量断言里重复出现的两个入参路径（同一条键的多次求值，不是两个不同用例）。 */
const DEV_PROJ_PATH = "/Users/dev/proj";
const TMP_SYMLINKED_PATH = "/tmp/x/proj";

/**
 * 任何 runner 上都不存在的目录：原生 `realpathSync` 必抛，正好用来判定「文件系统状态不参与键
 * 计算」那条。写成常量而不是四处字面量，是因为这几处断言判的是同一个入参。
 */
const ABSENT_PATH = "/w/proj/backend";

describe("deriveProjectKey", () => {
  it("绝对已规范路径：与旧实现逐字节相同（存量桶不迁移）", () => {
    // 字面量断言：这两个串是跨系统契约的锚点，任何改动都会立刻红在这里。
    expect(deriveProjectKey(DEV_PROJ_PATH, posixKey)).toBe("proj-75ff31d9");
    expect(deriveProjectKey("/repo/proj/src", posixKey)).toBe("src-86c69f49");
    expect(deriveProjectKey(DEV_PROJ_PATH, posixKey)).toBe(legacyKey(DEV_PROJ_PATH));
  });

  it("不注入 sep：走 runner 自己的路径语义", () => {
    // 消费方生产上就是这么调的（不带 opts）：默认臂必须与显式要 runner 分隔符同键。
    // 两侧 realpath 一边原生、一边恒等却仍相等，靠的正是「文件系统状态不参与键计算」。
    expect(deriveProjectKey(ABSENT_PATH)).toBe(
      deriveProjectKey(ABSENT_PATH, { ...noFs, sep: path.sep }),
    );
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
      sep: path.posix.sep,
    };
    expect(deriveProjectKey(TMP_SYMLINKED_PATH, viaSymlink)).toBe(
      deriveProjectKey("/private/tmp/x/proj", posixKey),
    );
    expect(deriveProjectKey(TMP_SYMLINKED_PATH, viaSymlink)).not.toBe(
      deriveProjectKey(TMP_SYMLINKED_PATH, posixKey),
    );
  });

  it("realpath 抛错（ENOENT/EACCES）：退回 resolve 结果继续，不向上抛", () => {
    const hostile = {
      realpath: (): string => {
        throw new Error("EACCES: permission denied");
      },
      sep: path.posix.sep,
    };
    expect(deriveProjectKey("/a/b/", hostile)).toBe("b-662b7b62");
    expect(deriveProjectKey("/a/b", hostile)).toBe(deriveProjectKey("/a/b", posixKey));
  });

  it("同一 cwd 幂等（重复调用同键）", () => {
    expect(deriveProjectKey(ABSENT_PATH, noFs)).toBe(deriveProjectKey(ABSENT_PATH, noFs));
  });

  it("Windows 字形：尾段是目录名，不是整条路径", () => {
    expect(deriveProjectKey(winPath("C:", "Users", "dev", "my-proj"), winKey)).toMatch(
      /^my-proj-[0-9a-f]{8}$/u,
    );
  });

  it("Windows：同一目录的两种分隔符写法同键（Win32 API 上二者同义）", () => {
    expect(deriveProjectKey(winPath("C:", "Users", "dev", "p"), winKey)).toBe(
      deriveProjectKey("C:/Users/dev/p", winKey),
    );
    const doubled = winPath("C:", "Users", "dev", "p") + path.win32.sep.repeat(2);
    expect(deriveProjectKey(doubled, winKey)).toBe(
      deriveProjectKey(winPath("C:", "Users", "dev", "p"), winKey),
    );
  });

  it("Windows 盘符根 → default（不给根造一个冒充真实目录的桶）", () => {
    const root = winPath("C:", "");
    const rootOnly = { realpath: (): string => root, sep: path.win32.sep };
    expect(deriveProjectKey(root, rootOnly)).toBe("default");
  });

  it("Windows UNC 共享根 → default（折完与 POSIX 两段目录同形，只能在折之前判）", () => {
    // 回归钉的是判据的**位置**：UNC 根折完是 `/server/share`，与合法的 `/a/b` 无法区分，
    // 所以判据必须作用于折分隔符之前的串。原先漏判时它落成 `share-<hash>`。
    const shareRoot = `${path.win32.sep}${path.win32.sep}server${path.win32.sep}share`;
    expect(deriveProjectKey(shareRoot, winKey)).toBe("default");
    // 带尾分隔符是同一件事的另一种写法，一并钉住。
    expect(deriveProjectKey(`${shareRoot}${path.win32.sep}`, winKey)).toBe("default");
    // 共享根下的真目录不受影响：判据不该把「两段」一刀切，也不该吃掉合法子目录。
    const under = `${shareRoot}${path.win32.sep}proj`;
    expect(deriveProjectKey(under, winKey)).toMatch(/^proj-[0-9a-f]{8}$/u);
  });

  it("POSIX 上反斜杠是合法文件名字符：不得当分隔符拆段", () => {
    const literalBackslashName = `/a/my${path.win32.sep}proj`;
    expect(deriveProjectKey(literalBackslashName, posixKey)).toMatch(/^my\\proj-[0-9a-f]{8}$/u);
    expect(deriveProjectKey(literalBackslashName, posixKey)).not.toBe(
      deriveProjectKey("/a/my", posixKey),
    );
  });
});
