// test/build-artifacts.test.ts —— 构建机械件（lib/build-artifacts.ts）的行为面。
//
// 这些件此前散在各包 build-utils.mjs 的近似副本里，各仓只测自己那半；收进 shared 之后
// 判据在这里一份测全：输出守卫的负形状、原子落盘的失败与重试路径、直跑守卫的两种失败
// 分工，以及 bundle 释放不让清理噪音顶掉错因。
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  asRecord,
  closeQuietly,
  invokedDirectly,
  isRecord,
  packageNameOf,
  readManifest,
  singleEntryChunk,
  writeArtifact,
} from "../lib/build-artifacts.ts";
import type { OutputItem } from "../lib/build-artifacts.ts";

// rename / writeFile / rm 的受控故障计划：默认全部直通真实实现，用例按需塞故障。
// vi.hoisted 让它在 vi.mock 工厂提升执行时就已经存在。
const writePlan = vi.hoisted(() => ({
  renameFailures: [] as { code: string }[],
  renameRawThrow: false,
  writeFileFails: false,
  rmFails: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn<typeof actual.rename>(async (...args: Parameters<typeof actual.rename>) => {
      const failure = writePlan.renameFailures.shift();
      if (failure !== undefined) {
        const error = new Error(`synthetic ${failure.code}`);
        Object.assign(error, failure);
        throw error;
      }
      if (writePlan.renameRawThrow) {
        // 非 Error 形态的失败：重试判据只认「带 code 的对象」，这一类必须原样上抛。
        // oxlint-disable-next-line eslint/no-throw-literal typescript/only-throw-error -- 刻意的非 Error 形态，测重试判据的原样上抛分支。
        throw "raw rename failure";
      }
      return actual.rename(...args);
    }),
    writeFile: vi.fn<typeof actual.writeFile>(
      async (...args: Parameters<typeof actual.writeFile>) => {
        if (writePlan.writeFileFails) {
          throw new Error("synthetic write failure");
        }
        return actual.writeFile(...args);
      },
    ),
    rm: vi.fn<typeof actual.rm>(async (...args: Parameters<typeof actual.rm>) => {
      if (writePlan.rmFails) {
        throw new Error("synthetic rm failure");
      }
      return actual.rm(...args);
    }),
  };
});

/**
 * 备份并替换 argv[1]；用例体跑完恢复。
 * @param value - 新的 argv[1]（undefined 表示截掉）
 * @param body - 用例体
 */
async function withArgv1(
  value: string | undefined,
  body: () => void | Promise<void>,
): Promise<void> {
  const original = [...process.argv];
  if (value === undefined) {
    process.argv.length = 1;
  } else {
    process.argv[1] = value;
  }
  try {
    await body();
  } finally {
    process.argv.splice(0, process.argv.length, ...original);
  }
}

/** 造一个最小 chunk；判据只看 type/fileName/isEntry/code。 */
function chunk(extra: Partial<OutputItem> = {}): OutputItem {
  return { type: "chunk", fileName: "a.js", isEntry: true, code: "export {};", ...extra };
}

/** 每条用例后的计划复位（rm/writeFile 直通、故障清空）。 */
function resetPlan(): void {
  writePlan.renameFailures.length = 0;
  writePlan.renameRawThrow = false;
  writePlan.writeFileFails = false;
  writePlan.rmFails = false;
}

/** 造一个临时目录当包根。 */
async function freshDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "build-artifacts-"));
}

describe("packageNameOf", () => {
  it("四种形态：裸名、裸名带子路径、scope 名、scope 名带子路径", () => {
    assert.equal(packageNameOf("pkg"), "pkg");
    assert.equal(packageNameOf("pkg/sub"), "pkg");
    assert.equal(packageNameOf("@scope"), "@scope");
    assert.equal(packageNameOf("@scope/pkg/sub"), "@scope/pkg");
  });
});

describe("对象守卫", () => {
  it("isRecord：普通对象为真，数组与 null 与标量为假", () => {
    assert.equal(isRecord({}), true);
    assert.equal(isRecord([]), false);
    assert.equal(isRecord(null), false);
    assert.equal(isRecord("x"), false);
  });

  it("asRecord：非对象折成空对象", () => {
    assert.deepEqual(asRecord([1, 2]), {});
    assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  });
});

describe("readManifest", () => {
  it("读包根 package.json", async () => {
    const dir = await freshDir();
    try {
      await writeFile(path.join(dir, "package.json"), `{"name":"x"}`, "utf8");
      assert.deepEqual(await readManifest(dir), { name: "x" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("坏 JSON 报点名文件的信息", async () => {
    const dir = await freshDir();
    try {
      await writeFile(path.join(dir, "package.json"), "{oops", "utf8");
      await assert.rejects(readManifest(dir), /package\.json/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("文件缺失同样报点名文件的信息", async () => {
    const dir = await freshDir();
    try {
      await assert.rejects(readManifest(dir), /package\.json/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("单文件产物的输出守卫", () => {
  it("拒绝零项与多项输出", () => {
    assert.throws(() => singleEntryChunk([], "entry.ts"), /0 项输出/u);
    assert.throws(
      () => singleEntryChunk([chunk(), chunk({ fileName: "b.js" })], "entry.ts"),
      /2 项输出/u,
    );
  });

  it("拒绝 asset 与非 entry 的单个 chunk", () => {
    assert.throws(
      () => singleEntryChunk([{ type: "asset", fileName: "x.css" }], "entry.ts"),
      /entry chunk/u,
    );
    assert.throws(() => singleEntryChunk([chunk({ isEntry: false })], "entry.ts"), /entry chunk/u);
  });

  it("拒绝空正文与纯空白正文", () => {
    assert.throws(() => singleEntryChunk([chunk({ code: "" })], "entry.ts"), /带正文/u);
    assert.throws(() => singleEntryChunk([chunk({ code: " \n\t " })], "entry.ts"), /带正文/u);
  });

  it("接受唯一的 entry chunk 并交回正文", () => {
    assert.equal(singleEntryChunk([chunk()], "entry.ts").code, "export {};");
  });

  it("输出项缺席（洞元素）按非 chunk 处理", () => {
    const hole = [undefined] as unknown as readonly OutputItem[];
    assert.throws(() => singleEntryChunk(hole, "entry.ts"), /entry chunk/u);
  });
});

/**
 * 读一份文本文件（readFile 未被 mock 替换，直通真实实现）。
 * @param file - 绝对路径
 * @returns 文件正文
 */
async function readFileOf(file: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(file, "utf8");
}

describe("writeArtifact", () => {
  it("成功路径：正文落目标，草稿不残留", async () => {
    resetPlan();
    const dir = await freshDir();
    try {
      const target = path.join(dir, "host.js");
      await writeArtifact(target, "payload");
      assert.equal(await readFileOf(target), "payload");
      const scratchDir = path.join(dir, ".tmp");
      assert.deepEqual(await readdir(scratchDir), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("Windows 占用码退避后重试成功", async () => {
    resetPlan();
    writePlan.renameFailures.push({ code: "EPERM" }, { code: "EBUSY" });
    const dir = await freshDir();
    try {
      const target = path.join(dir, "client.js");
      await writeArtifact(target, "payload");
      assert.equal(await readFileOf(target), "payload");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("退避耗尽后抛出，草稿已清", async () => {
    resetPlan();
    // 初次 + 三次退避重试 = 四次 rename 都失败，第四次已无退避档可等。
    writePlan.renameFailures.push(
      { code: "EACCES" },
      { code: "EACCES" },
      { code: "EACCES" },
      { code: "EACCES" },
    );
    const dir = await freshDir();
    try {
      const target = path.join(dir, "host.js");
      await assert.rejects(writeArtifact(target, "x"), /写产物失败：.*EACCES/su);
      assert.deepEqual(await readdir(path.join(dir, ".tmp")), []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("非对象形态的失败原样上抛（不带 code 就不是可重试的形状）", async () => {
    resetPlan();
    writePlan.renameRawThrow = true;
    const dir = await freshDir();
    try {
      await assert.rejects(
        writeArtifact(path.join(dir, "host.js"), "x"),
        /写产物失败：.*raw rename failure/su,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("非占用码立即抛出，不进退避", async () => {
    resetPlan();
    writePlan.renameFailures.push({ code: "ENOENT" });
    const dir = await freshDir();
    try {
      await assert.rejects(writeArtifact(path.join(dir, "host.js"), "x"), /ENOENT/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("写草稿失败：清草稿（清失败也不盖错因）后抛出", async () => {
    resetPlan();
    writePlan.writeFileFails = true;
    writePlan.rmFails = true;
    const dir = await freshDir();
    try {
      await assert.rejects(
        writeArtifact(path.join(dir, "host.js"), "x"),
        /synthetic write failure/u,
      );
      // 复位再交还 finally：清理本身也要用 rm，故障开着会误伤夹具删除。
      resetPlan();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("closeQuietly", () => {
  it("正常释放", async () => {
    resetPlan();
    let closed = false;
    await closeQuietly({
      close: async () => {
        closed = true;
      },
    });
    assert.equal(closed, true);
  });

  it("释放失败只记日志，不抛", async () => {
    resetPlan();
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args.map(String).join(" "));
    };
    try {
      await closeQuietly({
        close: async () => {
          throw new Error("close boom");
        },
      });
    } finally {
      console.error = original;
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /释放 rolldown bundle 失败/u);
  });
});

describe("invokedDirectly", () => {
  it("argv[1] 缺席或为空串：非直跑", async () => {
    resetPlan();
    await withArgv1(undefined, () => {
      assert.equal(invokedDirectly("/x/build-host.mjs"), false);
    });
    await withArgv1("", () => {
      assert.equal(invokedDirectly("/x/build-host.mjs"), false);
    });
  });

  it("基名不同：非直跑（不走 realpath）", async () => {
    resetPlan();
    await withArgv1(path.join(tmpdir(), "build-client.mjs"), () => {
      assert.equal(invokedDirectly(import.meta.filename), false);
    });
  });

  it("argv[1] 即本文件：直跑", async () => {
    resetPlan();
    await withArgv1(import.meta.filename, () => {
      assert.equal(invokedDirectly(import.meta.filename), true);
    });
  });

  it("基名相同但 argv[1] 解不出 realpath：抛「构建未发生」", async () => {
    resetPlan();
    const broken = path.join(tmpdir(), path.basename(import.meta.filename));
    await withArgv1(broken, () => {
      assert.throws(() => invokedDirectly(import.meta.filename), /构建未发生/u);
    });
  });
});
