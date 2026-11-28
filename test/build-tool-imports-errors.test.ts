// build-tool-imports 的错误分支：默认 tool-map 读取失败时必须点名文件与修复命令，
// 而不是让 transform 静默退回整条 `/tool` barrel。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAst } from "rolldown/parseAst";
import { toolImportTransform } from "../lib/build-tool-imports.ts";

const { resolveMock, readFileSyncMock } = vi.hoisted(() => ({
  resolveMock: vi.fn<(specifier: string) => string>(),
  readFileSyncMock: vi.fn<(path: string, encoding: string) => string>(),
}));

vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: resolveMock }),
}));

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
}));

const factory = (): { name: string } => ({ name: "test-transform-imports" });
const MANIFEST = "/tmp/shared/package.json";

function readDefaultMap(): void {
  void toolImportTransform({ transformImports: factory, parseAst });
}

describe("toolImportTransform() 的 tool-map 读取失败", () => {
  beforeEach(() => {
    resolveMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("解析不到 shared/package.json 时点名包与原因", () => {
    resolveMock.mockImplementation(() => {
      throw new Error("MODULE_NOT_FOUND");
    });
    expect(readDefaultMap).toThrow(/解析不到 @jayyuen66\/dsh-plugin-shared\/package\.json/u);
    expect(readDefaultMap).toThrow(/MODULE_NOT_FOUND/u);
  });

  it("tool-map 读不出时点名路径与重建命令", () => {
    resolveMock.mockReturnValue(MANIFEST);
    readFileSyncMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(readDefaultMap).toThrow(/读不出 shared 的 .*tool-map\.json/u);
    expect(readDefaultMap).toThrow(/node build-host\.mjs/u);
  });

  it.each([
    ["null", /不是「导出名 → 模块名」的对象/u],
    ["[]", /不是「导出名 → 模块名」的对象/u],
    ['"x"', /不是「导出名 → 模块名」的对象/u],
    ["{}", /是空表/u],
    ['{"a-b":"record"}', /导出名 "a-b" 无法路由/u],
    ['{"foo$":"record"}', /导出名 "foo\$" 无法路由/u],
    ['{"x":1}', /非法模块名 1/u],
    ['{"x":"Bad_Name"}', /非法模块名 Bad_Name/u],
  ])("tool-map 值为 %s 时拒绝", (raw, pattern) => {
    resolveMock.mockReturnValue(MANIFEST);
    readFileSyncMock.mockReturnValue(raw);
    expect(readDefaultMap).toThrow(pattern);
  });
});
