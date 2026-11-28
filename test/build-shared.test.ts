// build-shared 的两个导出各对应一类「静默失败」：入口判断错了会 exit 0 却什么都不建；
// 清单结构读松了会把应外部化的依赖打进产物。这里直接钉住原生 main 优先、回退边界与清单校验。
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createIsExternal, isMainModule } from "../build-shared.mjs";

const originalArgv = [...process.argv];
const roots: string[] = [];

/** 建一个临时目录并登记清理。 */
async function makeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "dsh-build-shared-"));
  roots.push(dir);
  return dir;
}

/** 建一个只含 package.json 的临时包根；manifest 原文由调用方给，便于造非法 JSON。 */
async function makeRoot(manifest: string): Promise<string> {
  const dir = await makeDir();
  await writeFile(path.join(dir, "package.json"), manifest, "utf8");
  return dir;
}

/** 建一个真实文件（realpath 回退需要它存在）。 */
async function makeFile(name: string): Promise<string> {
  const dir = await makeDir();
  const file = path.join(dir, name);
  await writeFile(file, "", "utf8");
  return file;
}

const VALID_MANIFEST = JSON.stringify({
  dependencies: { "@scope/pkg": "^1.0.0", plain: "^2.0.0" },
  peerDependencies: { "@scope/peer": "^3.0.0" },
});

describe("build-shared", () => {
  afterEach(() => {
    process.argv.splice(0, process.argv.length, ...originalArgv);
  });

  afterAll(async () => {
    await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  describe("isMainModule", () => {
    it("原生 main 为 false 时不走 argv 回退（node -e 误判）", async () => {
      const file = await makeFile("entry.mjs");
      process.argv[1] = file;
      expect(isMainModule({ url: pathToFileURL(file).href, main: false })).toBe(false);
    });

    it("原生 main 为 true 时直接判入口", () => {
      expect(isMainModule({ url: "file:///does-not-exist.mjs", main: true })).toBe(true);
    });

    it("没有原生值时按 realpath 比较 argv[1] 与调用方 URL", async () => {
      const file = await makeFile("entry.mjs");
      process.argv[1] = file;
      expect(isMainModule({ url: pathToFileURL(file).href })).toBe(true);
    });

    it("没有原生值且 argv[1] 指向别的文件时为 false", async () => {
      const entry = await makeFile("entry.mjs");
      const other = await makeFile("other.mjs");
      process.argv[1] = other;
      expect(isMainModule({ url: pathToFileURL(entry).href })).toBe(false);
    });

    it("argv[1] 缺失时直接判 false", async () => {
      const file = await makeFile("entry.mjs");
      process.argv.length = 1;
      expect(isMainModule({ url: pathToFileURL(file).href })).toBe(false);
    });

    it("argv[1] 指不到真实文件时判 false", async () => {
      const file = await makeFile("entry.mjs");
      const dir = await makeDir();
      process.argv[1] = path.join(dir, "missing.mjs");
      expect(isMainModule({ url: pathToFileURL(file).href })).toBe(false);
    });

    it("调用方不是 file: URL 时判 false", async () => {
      const file = await makeFile("entry.mjs");
      process.argv[1] = file;
      expect(isMainModule({ url: "data:text/javascript,export{}" })).toBe(false);
    });

    it.skipIf(process.platform === "win32")("回退按真实路径比较符号链接", async () => {
      const file = await makeFile("entry.mjs");
      const link = `${file}.link`;
      await symlink(file, link);
      process.argv[1] = link;
      expect(isMainModule({ url: pathToFileURL(file).href })).toBe(true);
    });
  });

  describe("createIsExternal", () => {
    it("按包名段外部化 dependencies 与 peerDependencies", async () => {
      const isExternal = await createIsExternal(await makeRoot(VALID_MANIFEST));
      expect(isExternal("@scope/pkg/sub")).toBe(true);
      expect(isExternal("plain/anything")).toBe(true);
      expect(isExternal("@scope/peer")).toBe(true);
      expect(isExternal("other")).toBe(false);
    });

    it("extraNames 归一到包名段：整包与子路径都命中", async () => {
      const isExternal = await createIsExternal(await makeRoot(VALID_MANIFEST), [
        "react-dom",
        "vitest/config",
        "@scope/extra/sub",
      ]);
      expect(isExternal("react-dom/client")).toBe(true);
      expect(isExternal("vitest")).toBe(true);
      expect(isExternal("vitest/config")).toBe(true);
      expect(isExternal("@scope/extra/anything")).toBe(true);
    });

    it.each([
      ["根为 null", "null", /根值必须是对象/u],
      ["根为数组", "[]", /根值必须是对象/u],
      ["dependencies 为数组", JSON.stringify({ dependencies: [] }), /dependencies 必须是对象/u],
      [
        "peerDependencies 为字符串",
        JSON.stringify({ peerDependencies: "x" }),
        /peerDependencies 必须是对象/u,
      ],
      [
        "依赖值不是字符串",
        JSON.stringify({ dependencies: { broken: 1 } }),
        /dependencies\.broken 必须是字符串/u,
      ],
      ["空包名", JSON.stringify({ dependencies: { "": "1.0.0" } }), /空包名/u],
    ])("清单异常直接拒绝：%s", async (_label, manifest, pattern) => {
      await expect(createIsExternal(await makeRoot(manifest))).rejects.toThrow(pattern);
    });

    it("清单读不到时错误里带文件路径", async () => {
      await expect(createIsExternal(await makeDir())).rejects.toThrow(/读不出 .*package\.json/u);
    });

    it("清单不是合法 JSON 时错误里带文件路径", async () => {
      await expect(createIsExternal(await makeRoot("{not json"))).rejects.toThrow(
        /读不出 .*package\.json/u,
      );
    });

    it.each([
      "",
      "/abs/pkg",
      "./rel",
      "pkg/../x",
      String.raw`C:\pkg`,
      "has space",
      "@scope",
      "pkg@1.0.0",
    ])("extraNames 非法说明符直接拒绝：%s", async (name) => {
      await expect(createIsExternal(await makeRoot(VALID_MANIFEST), [name])).rejects.toThrow(
        /包说明符/u,
      );
    });

    it("extraNames 非字符串也拒绝", async () => {
      await expect(
        createIsExternal(await makeRoot(VALID_MANIFEST), [42 as unknown as string]),
      ).rejects.toThrow(/包说明符/u);
    });
  });
});
