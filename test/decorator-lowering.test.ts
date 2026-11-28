// test/decorator-lowering.test.ts —— 装饰器预转换的**判据**。
//
// 为什么单列：这套东西只有两条真判据 —— "这个文件要不要预转换"与"转换失败时能不能说清
// 为什么"。前者错了的表现是**产物合法但装饰器还在**（装载期才炸，构建报成功）；后者错了
// 的表现是只剩一句 ENOENT，看不出是 tsc 不在、参数不对，还是产物名推导错了。两者都不在
// 任何现有用例的覆盖面上。
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire, SourceMap } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { describe, it } from "vitest";
import { parseAst } from "rolldown/parseAst";

import {
  lowerStandardDecorators,
  needsDecoratorLowering,
  rolldownDecorators,
  tscFailureHeadOf,
  viteDecorators,
} from "../lib/decorator-lowering.ts";
import type {
  DecoratorLoweringOptions,
  LoweredDecorators,
  ParseSourceAst,
} from "../lib/decorator-lowering.ts";

const pkgDir = path.join(import.meta.dirname, "..");

/** 本仓自己的 tsc 入口（判据要跑真编译器，桩替代不了"tsc 到底吐出什么"）。 */
function tscEntry(): string {
  const manifestPath = createRequire(import.meta.url).resolve("typescript/package.json");
  return path.join(path.dirname(manifestPath), "bin", "tsc");
}

/** 门槛用例注入的解析器：与各消费仓 build-host.mjs / vitest.config.ts 注入的同一枚。 */
const PARSE_AST: ParseSourceAst = (code, id) => parseAst(code, { lang: "ts" }, id);

const OPTIONS: DecoratorLoweringOptions = { tscEntry: tscEntry(), parseAst: PARSE_AST };

/** 临时目录前缀（`mkdtemp` 会在它后面追加随机段）。 */
const TMP_PREFIX = "shared-deco-test-";

/** 装饰器声明的那一行：多处源文本都从它拼出来（字面量重复会被 sonarjs 判红）。 */
const CLASS_DECL = "@dec class A {}";
/** 不带装饰器的普通 TS 源文本：用来验"不命中"与"钩子交回原文"。 */
const PLAIN_SOURCE = `export const x = 1;\n`;
/** 假 tsc 写的产物正文：桩的最低限度输出，"真 tsc 会写什么"不归它管。 */
const STUB_EMIT = `export const x = 1;\n`;
/** 装饰器函数声明（各处源文本共用同一份）。 */
const DECL = "function dec(_v: unknown, _c: unknown): void {}";
/** 带装饰器的 TS 源文本：转换的输入，各处复用同一份。 */
const DECORATED_SOURCE = `${DECL}\n${CLASS_DECL}\n`;
/** 含方法装饰器的源文本（类装饰器与方法装饰器会产出不同的 metadata 接收者）。 */
const DECORATED_METHOD_SOURCE = `${DECL}\n@dec class A { @dec m() {} }\n`;
/** 形状门槛用例的输入：只含装饰器那一行。 */
const DECORATED_LINE = `${CLASS_DECL}\n`;
/** metadata 发布句在 tsc 产物里的固定开头（多处断言复用，避免字面量重复）。 */
const METADATA_PUBLISH = "Symbol.metadata, {";
/** 普通 TS 文件路径（不读盘，只用来喂形状门槛）。 */
const TS_PATH = "/some/a.ts";

/**
 * 拼一份最小合法映射（version/sources/names 齐全，只换 mappings）。
 * @param mappings - VLQ 串
 * @param names - name 表
 * @returns `.map` 正文
 */
function fakeMap(mappings: string, names: readonly string[] = []): string {
  return JSON.stringify({ version: 3, sources: ["source.ts"], names, mappings });
}

/** 在临时目录里造一份源文件，交回它的绝对路径与一份清理函数。 */
async function tempSource(
  fileName: string,
  source: string,
): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const file = path.join(dir, fileName);
  await writeFile(file, source);
  return {
    file,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 造一个假 tsc：按 `--outDir` 与最后一个参数（源文件）写出产物，用来走真 tsc 走不到的边界。
 * @param emit - 写进产物的正文（空串即「什么都没写」）
 * @param withMap - 是否连 `.map` 一起写
 * @returns 要传给 `DecoratorLoweringOptions.tscEntry` 的入口路径与清理函数
 */
async function fakeTsc(
  emit: string,
  mapBody: string | null,
): Promise<{ entry: string; cleanup: () => Promise<void> }> {
  // 被 `node <entry> --outDir … <file>` 直接执行，故是 CommonJS 脚本而不是 TS：
  // 这一层要验的是降级逻辑，不该再依赖一次编译。
  const script = [
    'const { mkdirSync, writeFileSync } = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    'const outDir = args[args.indexOf("--outDir") + 1];',
    "const source = args.at(-1);",
    "mkdirSync(outDir, { recursive: true });",
    'const base = path.basename(source).split(".")[0];',
    'const ext = source.endsWith(".mts") ? ".mjs" : source.endsWith(".cts") ? ".cjs" : ".js";',
    "const target = path.join(outDir, base + ext);",
    `const body = ${JSON.stringify(emit)};`,
    "writeFileSync(target, body);",
    ...(mapBody === null ? [] : [`writeFileSync(target + ".map", ${JSON.stringify(mapBody)});`]),
    "",
  ].join("\n");
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const entry = path.join(dir, "fake-tsc.cjs");
  await writeFile(entry, script);
  return {
    entry,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 造一个只失败、不写产物的假 tsc：把给定的 stdout/stderr 原样写出后以非零退出。
 * 用来咬住“退出码 + 两路诊断”这条失败链，而不是只看产物文件在不在。
 * @param stdout - 写到 stdout 的文本
 * @param stderr - 写到 stderr 的文本
 * @returns 入口路径与清理函数
 */
async function failingTsc(
  stdout: string,
  stderr: string,
): Promise<{ entry: string; cleanup: () => Promise<void> }> {
  const script = [
    `process.stdout.write(${JSON.stringify(stdout)});`,
    `process.stderr.write(${JSON.stringify(stderr)});`,
    "process.exit(1);",
    "",
  ].join("\n");
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const entry = path.join(dir, "failing-tsc.cjs");
  await writeFile(entry, script);
  return {
    entry,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 造一个只写 `.map`、不写 JS 的假 tsc：用来咬住“tsc 退出 0 但产物缺失”的那条失败链。
 * @param mapBody - 写进 `.map` 的正文
 * @returns 入口路径与清理函数
 */
async function mapOnlyTsc(
  mapBody: string,
): Promise<{ entry: string; cleanup: () => Promise<void> }> {
  const script = [
    'const { mkdirSync, writeFileSync } = require("node:fs");',
    'const path = require("node:path");',
    "const args = process.argv.slice(2);",
    'const outDir = args[args.indexOf("--outDir") + 1];',
    "const source = args.at(-1);",
    'const base = path.basename(source).split(".")[0];',
    'const ext = source.endsWith(".mts") ? ".mjs" : source.endsWith(".cts") ? ".cjs" : ".js";',
    "mkdirSync(outDir, { recursive: true });",
    `writeFileSync(path.join(outDir, base + ext + ".map"), ${JSON.stringify(mapBody)});`,
    "",
  ].join("\n");
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const entry = path.join(dir, "map-only-tsc.cjs");
  await writeFile(entry, script);
  return {
    entry,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 造一个被信号终止的假 tsc：`spawnSync` 会回 `status: null`、`signal: "SIGTERM"`。
 * Windows 没有信号语义：`process.kill(pid, "SIGTERM")` 以退出码 1 终止，spawnSync 回
 * `status: 1`、`signal: null`——信号臂在该平台只有 `tscFailureHeadOf` 的合成用例能到达。
 * @returns 入口路径与清理函数
 */
async function signalingTsc(): Promise<{ entry: string; cleanup: () => Promise<void> }> {
  const script = 'process.kill(process.pid, "SIGTERM");\n';
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const entry = path.join(dir, "signaling-tsc.cjs");
  await writeFile(entry, script);
  return {
    entry,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/**
 * 从 `SourceMap.findEntry` 的联合返回值里取原始行号。
 * @param entry - `findEntry` 的返回
 * @returns 0 基原始行号；没有映射时为 null
 */
function originalLineOf(entry: unknown): number | null {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "originalLine" in entry &&
    typeof entry.originalLine === "number"
  ) {
    return entry.originalLine;
  }
  return null;
}

/**
 * 从 `SourceMap.findEntry` 的联合返回值里取 name。
 * @param entry - `findEntry` 的返回
 * @returns name；没有 name 时为 null
 */
function nameOf(entry: unknown): string | null {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "name" in entry &&
    typeof entry.name === "string"
  ) {
    return entry.name;
  }
  return null;
}

/** 解析器桩：永远抛错，用来验“解析 tsc 产物失败”这条链。 */
const THROWING_PARSE_AST: ParseSourceAst = () => {
  throw new Error("stub parse fail");
};

/** 造一个 Identifier 节点（只给 AST 判据看，不求完整）。 */
function astIdentifier(name: string): Record<string, unknown> {
  return { type: "Identifier", name };
}

/** 造一个 MemberExpression 节点。 */
function astMember(object: unknown, property: unknown, computed = false): Record<string, unknown> {
  return { type: "MemberExpression", object, property, computed };
}

/** 造一个 CallExpression 节点。 */
function astCall(callee: unknown, args: unknown): Record<string, unknown> {
  return { type: "CallExpression", callee, arguments: args };
}

/** 造一个 ExpressionStatement 节点。 */
function astExpressionStatement(expression: unknown): Record<string, unknown> {
  return { type: "ExpressionStatement", expression };
}

/** 造一个 `Object.defineProperty(…)` 调用节点。 */
function astMetadataCall(args: unknown): Record<string, unknown> {
  return astCall(astMember(astIdentifier("Object"), astIdentifier("defineProperty")), args);
}

/** 造一个 `if (_metadata) …` 节点。 */
function astIfMetadata(consequent: unknown): Record<string, unknown> {
  return { type: "IfStatement", test: astIdentifier("_metadata"), consequent };
}

/**
 * 取必须存在的源映射（测试路径的断言集中在“必须带 map”上）。
 * @param out - 降级结果
 * @returns 非空源映射
 */
function mapOf(out: LoweredDecorators): NonNullable<LoweredDecorators["map"]> {
  const { map } = out;
  if (map === null) {
    throw new Error("测试路径必须带源映射");
  }
  return map;
}

/**
 * 断言一份畸形源映射会被点名拒绝，并交回错误消息。
 * @param body - 假 tsc 写出的 `.map` 正文
 * @param expected - 期望命中的错误片段
 * @param coverageHints - 是否走测试路径（只影响解码阶段）
 * @returns 错误消息
 */
async function assertBadMapRejected(
  body: string,
  expected = /Source Map v3/u,
  coverageHints = false,
): Promise<string> {
  const { file, cleanup } = await tempSource("bad-map.ts", DECORATED_LINE);
  const stub = await fakeTsc(STUB_EMIT, body);
  try {
    let caught: unknown;
    try {
      lowerStandardDecorators(
        DECORATED_LINE,
        file,
        {
          tscEntry: stub.entry,
          parseAst: PARSE_AST,
        },
        coverageHints,
      );
    } catch (error: unknown) {
      caught = error;
    }
    assert.ok(caught instanceof Error, `畸形映射必须抛错：${body}`);
    assert.match(caught.message, expected, body);
    return caught.message;
  } finally {
    await stub.cleanup();
    await cleanup();
  }
}

describe("要不要预转换：形状门槛", () => {
  it("行首装饰器、类体内联、export default 内联、赋值/数组内联都命中", () => {
    const cases: readonly string[] = [
      '@Remote("stats")\nexport class A {}\n',
      'export class B { @Remote("stats") m() {} }\n',
      "export default @dec class {}\n",
      "const C = @dec class {};\n",
      // 数组字面量里 `[` 后不会补空格；注释紧贴赋值号时剥注释后变成 `=@dec`。
      "const C = [@dec class {}];\n",
      "const C =/*c*/@dec class {};\n",
    ];
    for (const code of cases) {
      assert.equal(needsDecoratorLowering(TS_PATH, code, PARSE_AST), true, `漏了这种写法：${code}`);
    }
  });

  it("没有装饰器、或后缀不是 TS 时不命中", () => {
    assert.equal(needsDecoratorLowering(TS_PATH, PLAIN_SOURCE, PARSE_AST), false);
    assert.equal(needsDecoratorLowering("/some/a.js", DECORATED_LINE, PARSE_AST), false);
    assert.equal(needsDecoratorLowering("/some/a.json", DECORATED_LINE, PARSE_AST), false);
  });

  it(".mts / .cts 也是 TS：形状门槛认它们（产物后缀由下一组用例盯）", () => {
    assert.equal(needsDecoratorLowering("/some/a.mts", DECORATED_LINE, PARSE_AST), true);
    assert.equal(needsDecoratorLowering("/some/a.cts", DECORATED_LINE, PARSE_AST), true);
  });

  it("声明文件不命中（它不产出 JS）", () => {
    assert.equal(needsDecoratorLowering("/some/a.d.ts", DECORATED_LINE, PARSE_AST), false);
    assert.equal(needsDecoratorLowering("/some/a.d.mts", DECORATED_LINE, PARSE_AST), false);
    assert.equal(needsDecoratorLowering("/some/a.d.cts", DECORATED_LINE, PARSE_AST), false);
  });

  it("参数装饰器：判据当场拒绝，不交给 tsc 静默丢装饰器", () => {
    // 标准装饰器不支持参数位置；tsc 会报 TS1206 后仍然发射一份没有装饰器的 JS，
    // `--noCheck` 下甚至 exit 0。判据必须在这之前拦住，否则就是“构建成功、运行期装饰器消失”。
    const source = [
      "function dec(_v: unknown, _c: unknown): void {}",
      "class A { constructor(@dec private x: number) {} }",
      "",
    ].join("\n");
    assert.throws(() => needsDecoratorLowering("/some/param.ts", source, PARSE_AST), /参数装饰器/u);
  });

  it("解析器对语法错误抛错时，判据把它包成解析失败而不是静默放过", () => {
    // 真 rolldown `parseAst` 在 errors.length > 0 时抛错；适配器若把它吞成空 AST，
    // 一个带装饰器的坏文件会先被判成“不需要降级”，最后以非法 JS 进入产物。
    assert.throws(
      () => needsDecoratorLowering("/some/broken.ts", "class {", PARSE_AST),
      /解析 \/some\/broken\.ts 失败（装饰器预转换的判据）[\s\S]*Parse failed/u,
    );
  });

  it("注释与字符串里的 `@` 不是装饰器节点：不命中", () => {
    // JSDoc 里的 `@param` 以前会被文本门槛判成装饰器，纯文档文件也白跑一次 tsc。
    assert.equal(
      needsDecoratorLowering(
        TS_PATH,
        "/** 参数 @param x 说明 */\nexport const y = 1;\n",
        PARSE_AST,
      ),
      false,
    );
    assert.equal(
      needsDecoratorLowering(TS_PATH, "// @decorator 只是说明\nconst z = 1;\n", PARSE_AST),
      false,
    );
    assert.equal(needsDecoratorLowering(TS_PATH, 'const s = "@dec class {}";\n', PARSE_AST), false);
  });

  it("正则字面量与模板表达式里的引号/反引号不会把其后的装饰器遮掉", () => {
    // 文本遮蔽不识别正则：`/"/` 里的引号会被当成字符串起点，其后的 `@dec` 整个被遮，
    // 阴性结果于是变成「没有装饰器」——这正是实测复现过的非法产物来源。
    assert.equal(
      needsDecoratorLowering(TS_PATH, 'const r = /"/;\n@dec class C {}\n', PARSE_AST),
      true,
    );
    // 模板表达式的内层反引号不结束外层模板：`${`@fake`}` 之后仍是正文。
    const nested = ["const t = `", "$", "{`@fake`}`;\n@dec class C {}\n"].join("");
    assert.equal(needsDecoratorLowering(TS_PATH, nested, PARSE_AST), true);
  });

  it("注释的边界：文件末尾没有换行 / 块注释未闭合", () => {
    // 行注释吃到文件尾（末尾没有换行）——注释里的 `@dec` 不产生装饰器节点。
    assert.equal(
      needsDecoratorLowering(TS_PATH, "const a = 1; // @dec 只是说明", PARSE_AST),
      false,
    );
    // 块注释未闭合是语法错误：判据不许猜「没有装饰器」而静默放过，也不许白跑一次 tsc。
    assert.throws(
      () => needsDecoratorLowering(TS_PATH, "/* 未闭合 @dec class A {}", PARSE_AST),
      /解析 .* 失败/u,
    );
  });

  it("字符串里的转义不让 `@` 变成装饰器节点", () => {
    // 'a\\"@dec b' 里被转义的引号仍是字符串内部，整段都不是装饰器。
    assert.equal(needsDecoratorLowering(TS_PATH, 'const s = "a\\"@dec b";\n', PARSE_AST), false);
  });

  it("解析树里混入的非节点对象不参与遍历，也不会让判据抛错", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    // 撤销后的 Proxy 是唯一能通过 `typeof === "object"` 却被 isRecord 判否的形状。
    // 它不是 AST 节点，也不是装饰器；遍历跳过即可，不能抛错。
    const stub: ParseSourceAst = () => ({ type: "Program", body: [], extra: proxy });
    assert.equal(needsDecoratorLowering(TS_PATH, "class C {}", stub), false);
  });
});

describe("产物后缀：按源后缀找 tsc 真正写出的那一份", () => {
  it(".mts 输入能降级成功（照 .js 找会 ENOENT）", async () => {
    const { file, cleanup } = await tempSource("a.mts", DECORATED_METHOD_SOURCE);
    try {
      // 传给转换的 code 必须与写盘的源一致：它会进源映射（sourcesContent），
      // 不一致时用例验的是另一份内容而毫无察觉。
      const out = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS);
      assert.ok(out.code.length > 0, "应当产出编译后的代码");
      assert.ok(out.code.includes("__esDecorate"), "装饰器应当被降级成调用");
      // 先按 null 判存在；再钉 sources 指回那份源文件的绝对路径——只断「有映射」的话，
      // sources 写成别的文件也不会红。
      const { map } = out;
      assert.notEqual(map, null, ".mts 同样要带源映射");
      assert.deepEqual(map?.sources, [file], "源映射要指回那份 .mts");
    } finally {
      await cleanup();
    }
  });

  it(".cts 输入能降级成功", async () => {
    const { file, cleanup } = await tempSource("a.cts", DECORATED_SOURCE);
    try {
      assert.ok(lowerStandardDecorators(DECORATED_SOURCE, file, OPTIONS).code.length > 0);
    } finally {
      await cleanup();
    }
  });

  it("虚拟模块 id：按同一份 code 编译，不读磁盘，sources 指回虚拟 id", () => {
    // 入口不读盘是这次修正的核心：判据看到什么，tsc 就编什么。虚拟 id 里带 `\0`，
    // 也要能走到同一条路径，而不是先 ENOENT。
    const id = "\0virtual:deco.ts";
    const out = lowerStandardDecorators(DECORATED_SOURCE, id, OPTIONS);
    assert.ok(out.code.includes("__esDecorate"), "虚拟模块也要真的降级");
    const map = mapOf(out);
    assert.deepEqual(map.sources, [id], "源映射要指回调用方给的模块 id");
    assert.deepEqual(
      map.sourcesContent,
      [DECORATED_SOURCE],
      "sourcesContent 必须是判据看到的那份 code",
    );
  });
});

describe("失败诊断：产物没出来时要说得出为什么", () => {
  it("tsc 非零退出时把 stdout 与 stderr 都带出来", async () => {
    // 真 tsc 在 --noResolve 下会把 TS2307 写到 stdout；只看 stderr 会丢掉真正的错因。
    // 这里两支都写满，钉住“两路都拼进错误消息”。
    const { file, cleanup } = await tempSource("tsc-fail.ts", DECORATED_LINE);
    const stub = await failingTsc("stdout-diagnostic", "stderr-diagnostic");
    try {
      let caught: unknown;
      try {
        lowerStandardDecorators(DECORATED_LINE, file, {
          tscEntry: stub.entry,
          parseAst: PARSE_AST,
        });
      } catch (error: unknown) {
        caught = error;
      }
      assert.ok(caught instanceof Error, "非零退出必须抛错");
      assert.match(caught.message, /tsc 装饰器降级失败/u);
      assert.match(caught.message, /stdout：stdout-diagnostic/u, "stdout 必须保留");
      assert.match(caught.message, /stderr：stderr-diagnostic/u, "stderr 必须保留");
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("stderr 为空时说明是空而不是留一个空白段", async () => {
    const { file, cleanup } = await tempSource("empty-stderr.ts", DECORATED_LINE);
    const stub = await failingTsc("only-stdout", "");
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(DECORATED_LINE, file, {
            tscEntry: stub.entry,
            parseAst: PARSE_AST,
          }),
        /stderr：（空）/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("空源文本原样返回（形状门槛已过，不必跑 tsc）", () => {
    const out = lowerStandardDecorators("", TS_PATH, OPTIONS);
    assert.equal(out.code, "");
    assert.equal(out.map, null);
  });

  it("tsc 什么都没写出来时点名「没有产出任何字节」（而不是回一段空代码）", async () => {
    // 真 tsc 至少会写一行 sourceMappingURL，所以这一支只能由一个「什么都不写」的假 tsc 走到。
    // 漏了它，产物为空的文件会静默变成空模块，装载期才在很远处炸。
    const { file, cleanup } = await tempSource("empty-out.ts", DECORATED_LINE);
    const stub = await fakeTsc("", null);
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(DECORATED_LINE, file, {
            tscEntry: stub.entry,
            parseAst: PARSE_AST,
          }),
        /装饰器降级没有产出任何字节/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("构建路径源映射缺席时照常交出代码（归因差一些，但不该让整个文件装不上）", async () => {
    // 没有 `.map` ⇒ map 保持 null：构建路径允许它缺席；测试路径另有一条必须失败的用例。
    const { file, cleanup } = await tempSource("no-map.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, null);
    try {
      const out = lowerStandardDecorators(DECORATED_LINE, file, {
        tscEntry: stub.entry,
        parseAst: PARSE_AST,
      });
      assert.equal(out.code, STUB_EMIT);
      assert.equal(out.map, null, "没有源映射时交 null，而不是编一份假的");
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("测试路径源映射缺席 ⇒ 当场失败，不让文件从覆盖率统计里消失", async () => {
    const { file, cleanup } = await tempSource("no-map-test.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, null);
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(
            DECORATED_LINE,
            file,
            { tscEntry: stub.entry, parseAst: PARSE_AST },
            true,
          ),
        /测试流水线需要源映射/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("源映射存在但形状非法 ⇒ 当场失败，不把畸形映射递出去", async () => {
    // `{"mappings":null}` 曾经在 try/catch 外 `.split(";")` 抛裸 TypeError；`{}` 则被当成
    // “有效但没有 mappings”的映射。三种形状都要落到同一条点名错误上。
    const messages = [
      await assertBadMapRejected("[]"),
      await assertBadMapRejected('{"mappings":null}'),
      await assertBadMapRejected('{"mappings":42}'),
      await assertBadMapRejected("{}"),
    ];
    assert.equal(messages.length, 4, "四种畸形映射都必须被点名拒绝");
  });

  it("源映射的 JSON / 单源 / sourcesContent / mappings 字段逐项校验", async () => {
    const messages = [
      await assertBadMapRejected("{not json", /不是合法 JSON/u),
      await assertBadMapRejected(
        '{"version":3,"sources":["a","b"],"names":[],"mappings":"AAAA"}',
        /单源映射/u,
      ),
      await assertBadMapRejected(
        '{"version":3,"sources":["a"],"sourcesContent":[],"names":[],"mappings":"AAAA"}',
        /sourcesContent/u,
      ),
      await assertBadMapRejected(
        '{"version":3,"sources":["a"],"names":[],"mappings":""}',
        /mappings 为空/u,
      ),
      await assertBadMapRejected(
        '{"version":3,"sources":["a"],"names":[1],"mappings":"AAAA"}',
        /Source Map v3/u,
      ),
      await assertBadMapRejected(
        '{"version":3,"sources":["a"],"sourcesContent":[1],"names":[],"mappings":"AAAA"}',
        /Source Map v3/u,
      ),
    ];
    assert.equal(messages.length, 6, "六种字段级畸形都必须被点名拒绝");
  });

  it("测试路径解码畸形 VLQ：截断、非法字符、字段数 ⇒ 点名拒绝", async () => {
    const messages = [
      await assertBadMapRejected(fakeMap("g"), /段被截断/u, true),
      await assertBadMapRejected(fakeMap("!"), /非法 base64/u, true),
      await assertBadMapRejected(fakeMap("AA"), /字段数非法/u, true),
      await assertBadMapRejected(fakeMap("AAAAAA"), /字段数非法/u, true),
    ];
    assert.equal(messages.length, 4, "四种解码错误都必须被点名拒绝");
  });

  it("测试路径保留 name 段，并把多于生成行的映射行截断", async () => {
    const { file, cleanup } = await tempSource("named.ts", DECORATED_LINE);
    const named = await fakeTsc(STUB_EMIT, fakeMap("AAAAA;AACA", ["x"]));
    const long = await fakeTsc(STUB_EMIT, fakeMap("AAAA;AACA;AACA;AACA;AACA"));
    try {
      const namedOut = lowerStandardDecorators(
        DECORATED_LINE,
        file,
        { tscEntry: named.entry, parseAst: PARSE_AST },
        true,
      );
      const namedMap = mapOf(namedOut);
      assert.deepEqual(namedMap.names, ["x"], "names 表必须在结果里保留");
      assert.equal(namedMap.mappings, "AAAAA;AACA", "五字段段应原样重编码");
      const sourceMap = new SourceMap({
        version: 3,
        file: "source.ts",
        sourceRoot: "",
        sources: namedMap.sources,
        names: namedMap.names ?? [],
        mappings: namedMap.mappings,
        sourcesContent: namedMap.sourcesContent ?? [],
      });
      assert.equal(nameOf(sourceMap.findEntry(0, 0)), "x", "五字段段的 name 不能在重编码时丢掉");

      const longOut = lowerStandardDecorators(
        DECORATED_LINE,
        file,
        { tscEntry: long.entry, parseAst: PARSE_AST },
        true,
      );
      assert.equal(
        mapOf(longOut).mappings.split(";").length,
        2,
        "映射行多于生成代码行时要截断到最后一行，不能留下悬空行",
      );
    } finally {
      await named.cleanup();
      await long.cleanup();
      await cleanup();
    }
  });

  it("单字段映射段（没有源坐标）在测试路径也能重编码", async () => {
    const { file, cleanup } = await tempSource("one-field.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, fakeMap("A"));
    try {
      const out = lowerStandardDecorators(
        DECORATED_LINE,
        file,
        { tscEntry: stub.entry, parseAst: PARSE_AST },
        true,
      );
      assert.equal(
        mapOf(out).mappings.split(";").length,
        2,
        "单字段段要保留，并按生成代码行数补齐空行",
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("没有 names / sourcesContent 字段的合法 map 也能读入（两者保持缺席）", async () => {
    const { file, cleanup } = await tempSource("bare-map.ts", DECORATED_LINE);
    const stub = await fakeTsc(
      STUB_EMIT,
      '{"version":3,"sources":["source.ts"],"mappings":"AAAA"}',
    );
    try {
      const out = lowerStandardDecorators(DECORATED_LINE, file, {
        tscEntry: stub.entry,
        parseAst: PARSE_AST,
      });
      const map = mapOf(out);
      assert.equal(map.names, undefined, "源映射没有 names 时不要凭空补一份");
      assert.deepEqual(map.sourcesContent, [DECORATED_LINE], "sourcesContent 仍要写回编译输入");
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("声明文件与非 TS 后缀在入口处被拒绝", () => {
    assert.throws(
      () => lowerStandardDecorators(DECORATED_LINE, "/some/a.d.ts", OPTIONS),
      /声明文件/u,
    );
    assert.throws(
      () => lowerStandardDecorators(DECORATED_LINE, "/some/a.js", OPTIONS),
      /只接受 \.ts\/\.mts\/\.cts/u,
    );
  });

  it("tsc 退出 0 但没写 JS ⇒ 点名产物缺失，并把两路诊断带上", async () => {
    const { file, cleanup } = await tempSource("no-emit.ts", DECORATED_LINE);
    const stub = await mapOnlyTsc(fakeMap("AAAA"));
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(DECORATED_LINE, file, {
            tscEntry: stub.entry,
            parseAst: PARSE_AST,
          }),
        /没有产出 source\.js[\s\S]*stdout：（空）[\s\S]*stderr：（空）/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("tscFailureHeadOf：信号臂与退出码臂的头部文案（合成入参，两臂全平台可达）", () => {
    assert.equal(
      tscFailureHeadOf("/src/a.ts", { signal: "SIGTERM", status: null }),
      "tsc 被信号终止（SIGTERM，/src/a.ts）",
    );
    assert.equal(
      tscFailureHeadOf("/src/a.ts", { signal: null, status: 1 }),
      "tsc 装饰器降级失败（/src/a.ts，退出码 1）",
    );
    assert.equal(tscFailureHeadOf("/src/a.ts", { signal: null, status: 0 }), null);
  });

  it("tsc 异常终止 ⇒ 报成因而不是把空产物当成成功", async () => {
    // Windows 的 process.kill(pid, "SIGTERM") 以退出码 1 终止（无信号语义），spawnSync 回
    // status 1 / signal null；信号臂只有 POSIX 的真实路径走得到，两臂文案另有合成用例。
    const { file, cleanup } = await tempSource("signal.ts", DECORATED_LINE);
    const stub = await signalingTsc();
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(DECORATED_LINE, file, {
            tscEntry: stub.entry,
            parseAst: PARSE_AST,
          }),
        process.platform === "win32" ? /退出码 1/u : /被信号终止（SIGTERM/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("解析器对 tsc 产物抛错时，降级失败并点名解析环节", async () => {
    const { file, cleanup } = await tempSource("parse-fail.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, fakeMap("AAAA"));
    try {
      assert.throws(
        () =>
          lowerStandardDecorators(
            DECORATED_LINE,
            file,
            { tscEntry: stub.entry, parseAst: THROWING_PARSE_AST },
            true,
          ),
        /解析 tsc 产物失败[\s\S]*stub parse fail/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("畸形 ast 节点只返回 false，不会把无效位置当成可裁剪行", async () => {
    // 真解析器不会给出这些形状；这里钉的是防御面：畸形 AST 不能让降级崩掉，也不能误删。
    const object = astIdentifier("Object");
    const defineProperty = astIdentifier("defineProperty");
    const symbol = astIdentifier("Symbol");
    const metadata = astIdentifier("metadata");
    const goodMetadataCall = astMetadataCall([astIdentifier("SomeName"), symbol, metadata]);
    const badCalleeCall = astCall(1, []);
    const badObjectCall = astCall(astMember(1, defineProperty), []);
    const computedCall = astCall(astMember(object, defineProperty, true), []);
    const badPropertyCall = astCall(astMember(object, { type: "Literal" }), []);
    const nonArrayArgsCall = astMetadataCall(1);
    const emptyArgsCall = astMetadataCall([]);
    const wrongArgsCall = astMetadataCall([astIdentifier("Other"), symbol, metadata]);
    const esDecorateCall = astCall(astIdentifier("__esDecorate"), []);
    const ast = {
      type: "Program",
      body: [
        { type: "VariableDeclaration" },
        {
          type: "IfStatement",
          test: astIdentifier("other"),
          consequent: astExpressionStatement(1),
        },
        astIfMetadata(1),
        astIfMetadata({ type: "EmptyStatement" }),
        astIfMetadata(astExpressionStatement(1)),
        astIfMetadata(astExpressionStatement(astIdentifier("x"))),
        astIfMetadata(astExpressionStatement(badCalleeCall)),
        astIfMetadata(astExpressionStatement(badObjectCall)),
        astIfMetadata(astExpressionStatement(computedCall)),
        astIfMetadata(astExpressionStatement(badPropertyCall)),
        astIfMetadata(astExpressionStatement(nonArrayArgsCall)),
        astIfMetadata(astExpressionStatement(emptyArgsCall)),
        astIfMetadata(astExpressionStatement(wrongArgsCall)),
        astIfMetadata({ type: "BlockStatement", body: 1 }),
        astIfMetadata({ type: "BlockStatement", body: [1] }),
        astIfMetadata({ type: "BlockStatement", body: [{ type: "EmptyStatement" }] }),
        astIfMetadata({
          type: "BlockStatement",
          body: [astExpressionStatement(goodMetadataCall)],
        }),
        esDecorateCall,
        { ...esDecorateCall, start: 5, end: 5 },
      ],
    };
    const parser: ParseSourceAst = () => ast;

    const { file, cleanup } = await tempSource("defensive-ast.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, fakeMap("AAAA"));
    try {
      const out = lowerStandardDecorators(
        DECORATED_LINE,
        file,
        { tscEntry: stub.entry, parseAst: parser },
        true,
      );
      assert.equal(out.code, STUB_EMIT, "畸形节点不应触发任何行删除");
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("tsc 入口是调用方注入的：换成不存在的入口 ⇒ 失败并抛错", () => {
    // 若实现自己 resolve 了 typescript，这个入口根本不会被用上，用例就绿不了。
    const bogus: DecoratorLoweringOptions = {
      tscEntry: path.join(pkgDir, "definitely-not-a-tsc.js"),
      parseAst: PARSE_AST,
    };
    assert.throws(
      () => lowerStandardDecorators(DECORATED_LINE, path.join(pkgDir, "x.ts"), bogus),
      /tsc 装饰器降级失败|无法启动 tsc/u,
    );
  });
});

describe("vite / rolldown 钩子：带 query 的 id 要剥掉 query 再当路径", () => {
  it("vite：`x.mts?import` 与 `x.mts` 走同一条路径（不剥 query 会因后缀不匹配而漏）", async () => {
    const plugin = viteDecorators(OPTIONS);
    const { file, cleanup } = await tempSource("q.mts", DECORATED_SOURCE);
    try {
      const out = plugin.transform(DECORATED_SOURCE, `${file}?import`);
      assert.notEqual(out, undefined, "带 query 的 id 也应当命中");
      assert.ok(out !== undefined && out.code.length > 0);
      assert.ok(out.code.includes("__esDecorate"), "钩子确实执行了降级，而不是原样回吐原文");
    } finally {
      await cleanup();
    }
  });

  it("vite：不带 query 且无装饰器时交回 undefined（流水线继续用原文）", () => {
    const plugin = viteDecorators(OPTIONS);
    assert.equal(plugin.transform(PLAIN_SOURCE, TS_PATH), undefined);
  });

  it("rolldown：同一份源码同样被降级，返回 null 而不是 undefined", async () => {
    const plugin = rolldownDecorators(OPTIONS);
    const { file, cleanup } = await tempSource("r.mts", DECORATED_SOURCE);
    try {
      const out = plugin.transform(DECORATED_SOURCE, `${file}?raw`);
      assert.notEqual(out, null, "带 query 的 id 也应当命中");
      assert.ok(out?.code.includes("__esDecorate") === true);
      assert.equal(plugin.transform(PLAIN_SOURCE, TS_PATH), null);
    } finally {
      await cleanup();
    }
  });

  it("两条插件的名字同源，且 vite 侧是 pre（要抢在别的转换器前面）", () => {
    assert.equal(viteDecorators(OPTIONS).name, rolldownDecorators(OPTIONS).name);
    assert.equal(viteDecorators(OPTIONS).enforce, "pre");
  });
});

describe("metadata 发布句：两条流水线都保留运行语义，测试路径只摘映射", () => {
  it("构建与测试都保留发布句，注入调用也保留", async () => {
    const { file, cleanup } = await tempSource("m.mts", DECORATED_METHOD_SOURCE);
    try {
      const forBuild = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS);
      assert.equal(
        forBuild.code.includes(METADATA_PUBLISH),
        true,
        "构建产物必须保留 metadata 发布语义",
      );
      const forTest = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS, true);
      assert.equal(
        forTest.code.includes(METADATA_PUBLISH),
        true,
        "测试路径也不得删除可执行的 metadata 发布句",
      );
      assert.equal(forTest.code, forBuild.code, "两条流水线的产物必须逐字节相同");
      assert.ok(forTest.code.includes("__esDecorate("), "注入的调用本身保留");
    } finally {
      await cleanup();
    }
  });

  it("被 tsc 打成多行的发布句：两条流水线都保留整条语句", async () => {
    // 源里写成多行的 `if`，tsc 把条件单独打一行、调用从下一行带缩进起（实测）。
    const source = [
      "declare const _metadata: unknown;",
      "declare const SomeName: Record<string, unknown>;",
      "if (_metadata) Object.defineProperty(SomeName, Symbol.metadata, {",
      "  enumerable: true,",
      "  writable: false,",
      "} as Record<string, unknown>);",
      DECL,
      CLASS_DECL,
      "",
    ].join("\n");
    const { file, cleanup } = await tempSource("split.ts", source);
    try {
      const forBuild = lowerStandardDecorators(source, file, OPTIONS);
      assert.ok(forBuild.code.includes("if (_metadata)"), "构建路径保留整条语句");
      const forTest = lowerStandardDecorators(source, file, OPTIONS, true);
      assert.ok(forTest.code.includes("if (_metadata)"), "测试路径保留整条语句");
      assert.equal(
        forTest.code.includes("Object.defineProperty(SomeName, Symbol.metadata"),
        true,
        "测试路径不得删除发布调用",
      );
      // 只解析不执行：残片的判据是语法，跑起来反而要造齐 __esDecorate 的作用域。
      assert.doesNotThrow(() => new Script(forTest.code), "保留的语句仍是合法 JS");
    } finally {
      await cleanup();
    }
  });

  it("模板字符串里的同形文本不会被删（含 sourceMappingURL 行）", async () => {
    // 文本锚点会把模板里的两行当成生成代码清空，直接改字符串值；AST 判据只认真正的
    // IfStatement 与文件尾注释，所以这两段必须原样保留。
    const source = [
      DECL,
      CLASS_DECL,
      "const doc = `intro",
      "//# sourceMappingURL=fake-map",
      "outro`;",
      "const doc2 = `before",
      "if (_metadata) Object.defineProperty(SomeName, Symbol.metadata, { value: 1 });",
      "after`;",
      "",
    ].join("\n");
    const { file, cleanup } = await tempSource("anchor-in-string.ts", source);
    try {
      for (const coverageHints of [false, true]) {
        const out = lowerStandardDecorators(source, file, OPTIONS, coverageHints);
        assert.ok(
          out.code.includes("//# sourceMappingURL=fake-map"),
          "模板里的 sourceMappingURL 行必须保留",
        );
        assert.ok(
          out.code.includes("if (_metadata) Object.defineProperty(SomeName, Symbol.metadata"),
          "模板里的 metadata 文本必须保留",
        );
        assert.doesNotThrow(() => new Script(out.code), "保留字符串不应破坏语法");
      }
    } finally {
      await cleanup();
    }
  });

  it("覆盖率提示：两条流水线产物相同，只摘掉注入样板的映射", async () => {
    const { file, cleanup } = await tempSource("c.ts", DECORATED_METHOD_SOURCE);
    try {
      const forBuild = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS);
      const forTest = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS, true);
      const buildLines = forBuild.code.split("\n");
      assert.equal(forTest.code, forBuild.code, "覆盖率提示不得改代码字节");
      const metadataAt = buildLines.findIndex((line) => line.includes(METADATA_PUBLISH));
      assert.notEqual(metadataAt, -1, "构建产物里应当有 metadata 发布句");
      const buildMapLines = mapOf(forBuild).mappings.split(";");
      const testMapLines = mapOf(forTest).mappings.split(";");
      assert.ok(buildMapLines.length > 0, "必须带逐行源映射");
      // tsc 的原始 map 可以比生成行少（尾部空行不落段）；测试路径重新编码后会补齐到
      // 生成行数，所以这里比的是“测试 map 与产物行数一致”，不是与原始 map 的行数相等。
      assert.equal(testMapLines.length, buildLines.length, "测试路径重新编码后与生成行数一致");
      assert.equal(testMapLines[metadataAt], "", "metadata 发布句的映射应被摘掉");
      // 至少有一行的映射项被抹空：那是 tsc 注入的 `__esDecorate(…)`。
      const dropped = testMapLines.filter(
        (line, index) => index < buildMapLines.length && line === "" && buildMapLines[index] !== "",
      );
      assert.ok(dropped.length > 0, "测试流水线应当把注入的调用从映射里摘掉");
    } finally {
      await cleanup();
    }
  });

  it("字段初始化里的手写表达式：__runInitializers 行不从测试映射里整行摘掉", async () => {
    // x = __runInitializers(this, _x_initializers, compute()); —— compute() 是手写业务代码，
    // 整行去映射会让覆盖率漏掉它。这一条钉住“只摘 __esDecorate 与 metadata”。
    const source = [
      DECL,
      "function compute(): number { return 1; }",
      "@dec class A { @dec x = compute(); }",
      "",
    ].join("\n");
    const { file, cleanup } = await tempSource("field-init.ts", source);
    try {
      const forBuild = lowerStandardDecorators(source, file, OPTIONS);
      const forTest = lowerStandardDecorators(source, file, OPTIONS, true);
      const buildLines = forBuild.code.split("\n");
      const index = buildLines.findIndex((line) => line.includes("_x_initializers, compute()"));
      assert.notEqual(index, -1, "tsc 应当把 compute() 和 __runInitializers 打在同一行");
      const buildMapLines = mapOf(forBuild).mappings.split(";");
      const testMapLines = mapOf(forTest).mappings.split(";");
      assert.notEqual(buildMapLines[index], "", "构建路径保留这一行的映射");
      assert.equal(
        testMapLines[index],
        buildMapLines[index],
        "测试路径不得整行摘掉手写表达式的映射",
      );
    } finally {
      await cleanup();
    }
  });

  it("裁剪注入行之后，手写语句仍映射回原来源行", async () => {
    // 这是整行置空方案最直接的回归面：`AAAA;;AACA` 会让后面的段落到源码前一行。
    // 用 Node 内置 SourceMap 查询生成行的原始坐标，而不是只数分号数量。
    const source = [
      DECL,
      "@dec class A { @dec m() {} }",
      "export function after(value: number): number {",
      "  return value + 1;",
      "}",
      "",
    ].join("\n");
    const { file, cleanup } = await tempSource("coords.ts", source);
    try {
      const out = lowerStandardDecorators(source, file, OPTIONS, true);
      const map = mapOf(out);
      const generatedLine = out.code
        .split("\n")
        .findIndex((line) => line.includes("function after"));
      assert.notEqual(generatedLine, -1, "tsc 产物里应当有手写函数");
      const sourceLine = source.split("\n").findIndex((line) => line.includes("function after"));
      const payload = {
        version: 3 as const,
        file: path.basename(file),
        sourceRoot: "",
        sources: map.sources,
        names: map.names ?? [],
        mappings: map.mappings,
        sourcesContent: map.sourcesContent ?? [],
      };
      const entry = new SourceMap(payload).findEntry(generatedLine, 0);
      const originalLine = originalLineOf(entry);
      assert.notEqual(originalLine, null, "手写语句必须有映射");
      assert.equal(originalLine, sourceLine, "生成行应映射到原来源行，而不是被前面的裁剪带偏");
    } finally {
      await cleanup();
    }
  });
});
