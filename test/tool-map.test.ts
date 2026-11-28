// tool-map.json 是消费方构建期拆 /tool 的唯一真源：它必须从 dist/tool.js 的真实导出面
// 生成，而不是手写清单。这里钉住几条最容易被「换构建器/改 barrel」打破的性质：
// 值导出落到稳定模块、code-points 的哈希 chunk 归到 text、每个目标模块都有对应产物。
import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseAst } from "rolldown/parseAst";

const pkgDir = path.resolve(import.meta.dirname, "..");
const mapPath = path.join(pkgDir, "dist", "tool-map.json");

/** 读构建生成的模块映射。 */
function readMap(): Record<string, string> {
  return JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>;
}

/** 声明式导出的最小结构面；不引 @oxc-project/types（它不在本包的直接类型依赖里）。 */
interface DeclarationLike {
  type: string;
  id?: { type: string; name?: string } | null;
  declarations?: { id: { type: string; name?: string } }[];
}

/** 声明式导出的名字（export const/function/class）。rolldown 通常会展平，这里仍按 AST 完整收。 */
function declarationNames(declaration: DeclarationLike): string[] {
  if (declaration.type === "VariableDeclaration" && declaration.declarations !== undefined) {
    return declaration.declarations.flatMap(({ id }) =>
      id.type === "Identifier" && id.name !== undefined ? [id.name] : [],
    );
  }
  if (
    (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
    declaration.id?.type === "Identifier" &&
    declaration.id.name !== undefined
  ) {
    return [declaration.id.name];
  }
  return [];
}

/** 导出说明符的结构面（Identifier 与字符串字面量两种右侧都覆盖）。 */
interface ExportedLike {
  type: string;
  name?: string;
  value?: string;
}

/** 一条具名导出声明的导出名（含声明式导出）。 */
function namesInExport(
  specifiers: readonly { exported: ExportedLike }[],
  declaration: DeclarationLike | null,
): string[] {
  const names: string[] = [];
  for (const specifier of specifiers) {
    const { exported } = specifier;
    const name = exported.type === "Identifier" ? exported.name : exported.value;
    if (name !== undefined) {
      names.push(name);
    }
  }
  if (declaration !== null) {
    names.push(...declarationNames(declaration));
  }
  return names;
}

/**
 * 一个 ESM 产物能被具名导入的名字集合。
 *
 * 这是**读方 link 时**的判据：消费方把 shared 当 external，`internal/tool/<module>` 是裸
 * 说明符，打包器不会校验具名导出；Node 装载时缺名字直接 SyntaxError。所以工具映射的每个
 * 目标都必须过这一条，不能只查文件存在。
 * @param file - dist 下的绝对路径
 * @returns 导出名集合
 */
function exportedNamesOf(file: string): Set<string> {
  const ast = parseAst(readFileSync(file, "utf8"), { lang: "js" }, file);
  const names = new Set<string>();
  for (const node of ast.body) {
    if (node.type === "ExportAllDeclaration") {
      throw new Error(`${file} 仍有未展开的 export *，无法核对导出面`);
    }
    if (node.type === "ExportDefaultDeclaration") {
      names.add("default");
    } else if (node.type === "ExportNamedDeclaration") {
      for (const name of namesInExport(node.specifiers, node.declaration)) {
        names.add(name);
      }
    }
  }
  return names;
}

describe("dist/tool-map.json", () => {
  it("值导出落到稳定模块（不是 barrel 自己的 tool）", () => {
    const map = readMap();
    assert.equal(map["isRecord"], "record");
    assert.equal(map["scanToolEvents"], "tool-events");
    assert.equal(map["LOCALE_SETTINGS_NAMESPACE"], "locale");
    assert.equal(map["fillPlaceholders"], "placeholder");
  });

  it("code-points 的哈希 chunk 归到稳定 text 入口", () => {
    const map = readMap();
    assert.equal(map["truncateCodePoints"], "text");
    assert.equal(map["truncateEnd"], "text");
  });

  it("每个导出名都能被官方 transform 路由（ASCII 标识符，不含正则元字符）", () => {
    // 官方插件把成员名编进 `new RegExp("^" + name + "$")`，重建导入时也不补引号：
    // `foo$` 这类正则元字符与 `"a-b"` 这类字面量名都表达不出来。构建期切面会拒绝它们，
    // 这里在 shared 自己的产物上先判一次，免得等到消费方构建才红。
    const map = readMap();
    const unroutable = Object.keys(map).filter((name) => !/^[A-Za-z_]\w*$/u.test(name));
    assert.deepEqual(
      unroutable,
      [],
      `tool-map 里有官方 transform 表达不了的导出名：${unroutable.join(", ")}`,
    );
  });

  it("每个目标模块都有随包发布的 dist/<module>.js 与 lib/<module>.ts", () => {
    const map = readMap();
    for (const moduleName of new Set(Object.values(map))) {
      assert.ok(
        existsSync(path.join(pkgDir, "dist", `${moduleName}.js`)),
        `tool-map 指向 ${moduleName}，但 dist/${moduleName}.js 不存在`,
      );
      assert.ok(
        existsSync(path.join(pkgDir, "lib", `${moduleName}.ts`)),
        `tool-map 指向 ${moduleName}，但 lib/${moduleName}.ts 不存在`,
      );
    }
  });

  it("每个映射目标都真的导出该名字（读方 link 的判据）", () => {
    const map = readMap();
    const missed: string[] = [];
    for (const [exported, moduleName] of Object.entries(map)) {
      const names = exportedNamesOf(path.join(pkgDir, "dist", `${moduleName}.js`));
      if (!names.has(exported)) {
        missed.push(`${exported} → ${moduleName}`);
      }
    }
    assert.deepEqual(
      missed,
      [],
      `tool-map 指向不导出该名字的模块（消费方装载期会 SyntaxError）：${missed.join(", ")}`,
    );
  });

  it("映射的键集合等于 dist/tool.js 的导出面（漏项与多项都要红）", () => {
    // 只查目标存在看不见「源码新增了一种导出形态、解析器静默跳过」：map 少一个键照样
    // 每条断言都过。rolldown 记录在 chunk 上的导出面就是读方能取到的完整集合，用它双向对账。
    const map = readMap();
    const declared = [...exportedNamesOf(path.join(pkgDir, "dist", "tool.js"))].toSorted();
    assert.deepEqual(Object.keys(map).toSorted(), declared);
  });
});
