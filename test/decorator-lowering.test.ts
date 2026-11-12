// test/decorator-lowering.test.ts —— 装饰器预转换的**判据**。
//
// 为什么单列：这套东西只有两条真判据 —— "这个文件要不要预转换"与"转换失败时能不能说清
// 为什么"。前者错了的表现是**产物合法但装饰器还在**（装载期才炸，构建报成功）；后者错了
// 的表现是只剩一句 ENOENT，看不出是 tsc 不在、参数不对，还是产物名推导错了。两者都不在
// 任何现有用例的覆盖面上。
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script } from "node:vm";

import { describe, it } from "vitest";

import {
  lowerStandardDecorators,
  needsDecoratorLowering,
  rolldownDecorators,
  viteDecorators,
} from "../lib/decorator-lowering.ts";
import type { DecoratorLoweringOptions } from "../lib/decorator-lowering.ts";

const pkgDir = path.join(import.meta.dirname, "..");

/** 本仓自己的 tsc 入口（判据要跑真编译器，桩替代不了"tsc 到底吐出什么"）。 */
function tscEntry(): string {
  const manifestPath = createRequire(import.meta.url).resolve("typescript/package.json");
  return path.join(path.dirname(manifestPath), "bin", "tsc");
}

const OPTIONS: DecoratorLoweringOptions = { tscEntry: tscEntry() };

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
/** 普通 TS 文件路径（不读盘，只用来喂形状门槛）。 */
const TS_PATH = "/some/a.ts";

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
    'const body = process.env.DECO_STUB_EMIT ?? "";',
    "writeFileSync(target, body);",
    'const mapBody = process.env.DECO_STUB_MAP ?? "";',
    'if (mapBody !== "") {',
    '  writeFileSync(target + ".map", mapBody);',
    "}",
    "",
  ].join("\n");
  const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
  const entry = path.join(dir, "fake-tsc.cjs");
  await writeFile(entry, script);
  // 假 tsc 经环境变量取参数：实现里 execFileSync 不传 env，子进程继承本进程环境。
  process.env["DECO_STUB_EMIT"] = emit;
  process.env["DECO_STUB_MAP"] = mapBody ?? "";
  return {
    entry,
    cleanup: async () => {
      delete process.env["DECO_STUB_EMIT"];
      delete process.env["DECO_STUB_MAP"];
      await rm(dir, { recursive: true, force: true });
    },
  };
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
      assert.equal(needsDecoratorLowering(TS_PATH, code), true, `漏了这种写法：${code}`);
    }
  });

  it("没有装饰器、或后缀不是 TS 时不命中", () => {
    assert.equal(needsDecoratorLowering(TS_PATH, PLAIN_SOURCE), false);
    assert.equal(needsDecoratorLowering("/some/a.js", DECORATED_LINE), false);
    assert.equal(needsDecoratorLowering("/some/a.json", DECORATED_LINE), false);
  });

  it(".mts / .cts 也是 TS：形状门槛认它们（产物后缀由下一组用例盯）", () => {
    assert.equal(needsDecoratorLowering("/some/a.mts", DECORATED_LINE), true);
    assert.equal(needsDecoratorLowering("/some/a.cts", DECORATED_LINE), true);
  });

  it("声明文件不命中（它不产出 JS）", () => {
    assert.equal(needsDecoratorLowering("/some/a.d.ts", DECORATED_LINE), false);
    assert.equal(needsDecoratorLowering("/some/a.d.mts", DECORATED_LINE), false);
    assert.equal(needsDecoratorLowering("/some/a.d.cts", DECORATED_LINE), false);
  });

  it("注释里的 `@param` 不命中：装饰器判据只看程序正文", () => {
    // JSDoc 里的 `@param` 前也是空白，不剥注释就会把纯文档文件也判成需要跑一次 tsc。
    assert.equal(
      needsDecoratorLowering(TS_PATH, "/** 参数 @param x 说明 */\nexport const y = 1;\n"),
      false,
    );
    // 行注释与字符串里的 `@` 一并遮蔽：字符串里出现 `@foo` 不再白跑一次 tsc。
    assert.equal(needsDecoratorLowering(TS_PATH, "// @decorator 只是说明\nconst z = 1;\n"), false);
    assert.equal(needsDecoratorLowering(TS_PATH, 'const s = "@dec class {}";\n'), false);
  });

  it("注释的两条边界：文件末尾没有换行、块注释未闭合", () => {
    // 行注释吃到文件尾（`indexOf("\n")` 回 -1）——不处理就会把结尾那段当正文继续扫。
    assert.equal(needsDecoratorLowering(TS_PATH, "const a = 1; // @dec 只是说明"), false);
    // 块注释未闭合：吃到文件尾，里面那个 `@dec` 必须一起被吃掉，否则含未闭合注释的文件会白跑一次 tsc。
    assert.equal(needsDecoratorLowering(TS_PATH, "/* 未闭合 @dec class A {}"), false);
  });

  it("字符串里的转义对整段跳过：被转义的引号不算字符串结束", () => {
    // 转义分支：'a\\"@dec b' 里那个反斜杠加引号是字符串内部的一个引号，剥注释时不能把它
    // 当成字符串结束 —— 否则后半段会被当正文扫，命中的那个 @dec 会白跑一次 tsc。
    assert.equal(needsDecoratorLowering(TS_PATH, 'const s = "a\\"@dec b";\n'), false);
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
});

describe("失败诊断：产物没出来时要说得出为什么", () => {
  it("源文件不存在时抛错，消息里点名产物与源路径，并带上 stderr 段", async () => {
    // 在 mkdtemp 出来的空目录里取一个必然不存在的路径：固定 tmpdir() 下会被上一次残留
    // 或别的机器上的同名文件带偏。
    const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
    const missing = path.join(dir, "does-not-exist.mts");
    try {
      // 用 try/catch 取错误本体而不是给 assert.throws 传校验回调：后者是本仓
      // `promise/prefer-await-to-callbacks` 明确要避免的回调形。
      let caught: unknown;
      try {
        lowerStandardDecorators(DECORATED_LINE, missing, OPTIONS);
      } catch (error: unknown) {
        caught = error;
      }
      assert.ok(caught instanceof Error, "源文件不存在时必须抛错");
      assert.match(caught.message, /装饰器降级没有产出/u);
      assert.match(caught.message, /does-not-exist\.mjs/u, "消息按 .mts 推出 .mjs");
      assert.match(caught.message, /does-not-exist\.mts/u, "消息要点名那份源文件，而不只是产物");
      assert.match(caught.message, /tsc stderr：/u, "必须保留 stderr 段");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stderr 为空时说明是空而不是留一个空白段", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), TMP_PREFIX));
    const missing = path.join(dir, "empty-stderr.ts");
    try {
      assert.throws(
        () => lowerStandardDecorators(DECORATED_LINE, missing, OPTIONS),
        /tsc stderr：（tsc 没有输出 stderr）/u,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
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
        () => lowerStandardDecorators(DECORATED_LINE, file, { tscEntry: stub.entry }),
        /装饰器降级没有产出任何字节/u,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("源映射缺席时照常交出代码（归因差一些，但不该让整个文件装不上）", async () => {
    // 没有 `.map` ⇒ map 保持 null、mappings 一路为 null：这一格是「源映射可选」的实现承诺。
    const { file, cleanup } = await tempSource("no-map.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, null);
    try {
      const out = lowerStandardDecorators(DECORATED_LINE, file, { tscEntry: stub.entry });
      assert.equal(out.code, STUB_EMIT);
      assert.equal(out.map, null, "没有源映射时交 null，而不是编一份假的");
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("源映射是合法 JSON 却不是记录（数组/标量）⇒ 交 null，不把畸形映射递出去", async () => {
    // `isSourceMap` 的数组与 null 两条否定支：少了它，`[]` 会被当映射往下传，
    // 后面读 `map.mappings` 全是 undefined，覆盖率归因静默失效。
    const { file, cleanup } = await tempSource("array-map.ts", DECORATED_LINE);
    const stub = await fakeTsc(STUB_EMIT, "[]");
    try {
      assert.equal(
        lowerStandardDecorators(DECORATED_LINE, file, { tscEntry: stub.entry }).map,
        null,
      );
    } finally {
      await stub.cleanup();
      await cleanup();
    }
  });

  it("tsc 入口是调用方注入的：换成不存在的入口 ⇒ 失败并抛错", () => {
    // 若实现自己 resolve 了 typescript，这个入口根本不会被用上，用例就绿不了。
    const bogus: DecoratorLoweringOptions = {
      tscEntry: path.join(pkgDir, "definitely-not-a-tsc.js"),
    };
    assert.throws(
      () => lowerStandardDecorators(DECORATED_LINE, path.join(pkgDir, "x.ts"), bogus),
      /装饰器降级没有产出/u,
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

describe("metadata 发布句：只裁锚点匹配得上的整条单行语句", () => {
  it("类装饰器产物的那条发布句也被裁掉（接收者不是 this 时同样要认出来）", async () => {
    const { file, cleanup } = await tempSource("m.mts", DECORATED_METHOD_SOURCE);
    try {
      const out = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS);
      assert.equal(out.code.includes("Symbol.metadata, {"), false, "发布句必须被裁掉");
      assert.ok(out.code.includes("__esDecorate("), "注入的调用本身保留");
    } finally {
      await cleanup();
    }
  });

  it("被 tsc 打成两行的发布句：锚点匹配不上 ⇒ 一行都不删，产物仍是合法 JS", async () => {
    // 源里写成多行的 `if`，tsc 把条件单独打一行、调用从下一行带缩进起（实测）。
    // 锚点要求前缀与调用同行，所以这里匹配不上 ⇒ **整条语句原样留着**，而不是删掉首行留下
    // 残片 —— 后者才是这条守卫要避免的后果。
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
      const out = lowerStandardDecorators(source, file, OPTIONS);
      const lines = out.code.split("\n");
      const condAt = lines.findIndex((line) => line.trim() === "if (_metadata)");
      assert.ok(condAt !== -1, "条件被单独打一行：锚点要求前缀与调用同行，这里匹配不上");
      assert.equal(
        lines[condAt + 1]?.trim(),
        "Object.defineProperty(SomeName, Symbol.metadata, {",
        "调用留在下一行、整条语句不得被动过",
      );
      // 只解析不执行：残片的判据是语法，跑起来反而要造齐 __esDecorate 的作用域。
      assert.doesNotThrow(() => new Script(out.code), "半条语句会是非法 JS");
    } finally {
      await cleanup();
    }
  });

  it("锚点匹配得上却不以 `);` 收尾时当场抛错，点名那一行", async () => {
    // 抛错支的真输入不需要桩：模板字面量里的同形文本落到产物就是那一行形（行首顶格、以 `{` 收尾）。
    // 源逐行拼出来（而非模板字面量）：本文件自己也要过装饰器流水线，而裁剪的锚点只看行首形状，
    // 拼成数组后每行都带引号与前导空格，匹配不上。
    const source = [
      DECL,
      CLASS_DECL,
      "const text = `",
      "if (_metadata) Object.defineProperty(SomeName, Symbol.metadata,",
      "  enumerable: true,",
      "});",
      "`;",
      "export { text };",
      "",
    ].join("\n");
    const { file, cleanup } = await tempSource("anchor-in-string.ts", source);
    try {
      let message: string | undefined;
      try {
        lowerStandardDecorators(source, file, OPTIONS);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      assert.ok(message !== undefined, "必须当场抛错，而不是发出半条语句的产物");
      // 三条各管一段：为什么炸、炸在哪一行、不炸会怎样。少了中间那条就得自己去产物里找。
      assert.match(message, /Symbol\.metadata 发布语句不是单行/u);
      assert.match(message, /if \(_metadata\) Object\.defineProperty\(SomeName/u);
      assert.match(message, /非法 JS/u);
    } finally {
      await cleanup();
    }
  });

  it("覆盖率提示：构建流水线不带、测试流水线把注入的调用从源映射里摘掉", async () => {
    const { file, cleanup } = await tempSource("c.ts", DECORATED_METHOD_SOURCE);
    try {
      const forBuild = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS);
      const forTest = lowerStandardDecorators(DECORATED_METHOD_SOURCE, file, OPTIONS, true);
      // 产物字节**逐字节相同**：提示只落在源映射里，构建产物不该为覆盖率留任何形状。
      assert.equal(forBuild.code, forTest.code, "coverageHints 不得改动产物字节");
      const buildLines = forBuild.map?.mappings?.split(";") ?? [];
      const testLines = forTest.map?.mappings?.split(";") ?? [];
      assert.ok(buildLines.length > 0, "必须带逐行源映射");
      assert.equal(testLines.length, buildLines.length, "摘映射项不动行数");
      // 至少有一行的映射项被抹空：那是 tsc 注入的 `__esDecorate(…)` / `__runInitializers(…)`。
      const dropped = testLines.filter((line, index) => line === "" && buildLines[index] !== "");
      assert.ok(dropped.length > 0, "测试流水线应当把注入的调用从映射里摘掉");
    } finally {
      await cleanup();
    }
  });
});
