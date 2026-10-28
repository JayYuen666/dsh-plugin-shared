// test/build-types-facet.test.ts —— 声明产物编排（lib/build-types.ts）的行为面。
//
// 说明符改写是纯函数，负形状（字符串字面量类型、.d.ts 自身后缀、跨行、mts/cts 对侧）逐条
// 固定；buildDeclarations 用真 tsc 跑一遍最小测试数据（成功换目录、失败保住上一轮产物），
// 子进程诊断透传（runTool）用真 node 进程造正负两路。
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  buildDeclarations,
  canonicalizeDeclarationSpecifiers,
  listDeclarations,
  runTool,
  textOf,
} from "../lib/build-types.ts";

// execFileSync 的受控故障计划：默认直通，用例按需让它抛非 Error 形态。
const execPlan = vi.hoisted(() => ({ rawThrow: false }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: ((...args: Parameters<typeof actual.execFileSync>) => {
      if (execPlan.rawThrow) {
        // oxlint-disable-next-line eslint/no-throw-literal typescript/only-throw-error -- 刻意抛非 Error 形态：runTool 的形态守卫需要这一侧的用例。
        throw "raw exec failure";
      }
      return actual.execFileSync(...args);
    }) as typeof actual.execFileSync,
  };
});

/** 本包依赖图里的 tsc 入口（与各消费方 build-types.mjs 的定位法相同）。 */
function tscEntryOf(): string {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("typescript/package.json");
  return path.join(path.dirname(manifestPath), "bin", "tsc");
}

describe("canonicalizeDeclarationSpecifiers", () => {
  it("from / import() / declare module 三种句法位置都改写", () => {
    const text = [
      'import { a } from "./lib/a.ts";',
      'export type B = import("./lib/b.ts").B;',
      'declare module "./lib/m.ts" {};',
    ].join("\n");
    const out = canonicalizeDeclarationSpecifiers(text);
    assert.ok(out.includes('from "./lib/a.js"'));
    assert.ok(out.includes('import("./lib/b.js")'));
    assert.ok(out.includes('declare module "./lib/m.js"'));
  });

  it("mts / cts 改成对侧产物后缀", () => {
    const out = canonicalizeDeclarationSpecifiers(
      'import { a } from "./a.mts";\nimport { b } from "./b.cts";\nimport { c } from "./c.ts";',
    );
    assert.ok(out.includes('from "./a.mjs"'));
    assert.ok(out.includes('from "./b.cjs"'));
    assert.ok(out.includes('from "./c.js"'));
  });

  it("字符串字面量类型与 .d.ts 后缀不动", () => {
    const text = 'export type P = "./lib/foo.ts";\nimport { x } from "./types/x.d.ts";';
    const out = canonicalizeDeclarationSpecifiers(text);
    assert.ok(out.includes('export type P = "./lib/foo.ts";'));
    assert.ok(out.includes('from "./types/x.d.ts"'));
  });

  it("裸说明符不动；非贪婪不吃掉 .d 段", () => {
    const text = 'import { f } from "node:fs";\nimport { g } from "./x.d.ts";';
    const out = canonicalizeDeclarationSpecifiers(text);
    assert.equal(out, text);
  });

  it("单引号同样认", () => {
    const out = canonicalizeDeclarationSpecifiers("import { a } from './lib/a.ts';");
    assert.ok(out.includes("from './lib/a.js';"));
  });
});

describe("textOf", () => {
  it("三种形态：字符串原样、Buffer 解码、其余空串", () => {
    assert.equal(textOf("diag"), "diag");
    assert.equal(textOf(Buffer.from("buf-diag", "utf8")), "buf-diag");
    assert.equal(textOf(42), "");
  });
});

describe("runTool", () => {
  it("成功：静默返回", () => {
    assert.doesNotThrow(() => {
      runTool(process.execPath, ["-e", ""], tmpdir());
    });
  });

  it("失败：stdout 诊断进错误信息", () => {
    assert.throws(() => {
      runTool(process.execPath, ["-e", "console.log('boom-diag'); process.exit(1)"], tmpdir());
    }, /boom-diag/u);
  });

  it("失败：stderr 诊断进错误信息", () => {
    assert.throws(() => {
      runTool(process.execPath, ["-e", "console.error('boom-stderr'); process.exit(2)"], tmpdir());
    }, /boom-stderr/u);
  });

  it("失败：子进程抛非 Error 形态时退回字符串化错误", () => {
    execPlan.rawThrow = true;
    try {
      assert.throws(() => {
        runTool(process.execPath, ["-e", ""], tmpdir());
      }, /raw exec failure/u);
    } finally {
      execPlan.rawThrow = false;
    }
  });

  it("失败：两路都空时退回包装层错误串", () => {
    assert.throws(() => {
      runTool(process.execPath, ["-e", "process.exit(3)"], tmpdir());
    }, /Command failed/u);
  });
});

describe("listDeclarations", () => {
  it("递归收 .d.ts，其余文件与目录不进清单", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "list-decl-"));
    try {
      await writeFile(path.join(dir, "host.d.ts"), "", "utf8");
      await writeFile(path.join(dir, "noise.js"), "", "utf8");
      await mkdir(path.join(dir, "lib"));
      await writeFile(path.join(dir, "lib", "a.d.ts"), "", "utf8");
      const files = await listDeclarations(dir, "");
      assert.deepEqual(files.toSorted(), ["host.d.ts", "lib/a.d.ts"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** 最小测试数据应产出的声明清单（多处共用，避免字面量重复）。 */
const EXPECTED_DECLS = ["host.d.ts", "lib/a.d.ts"] as const;

/** 造一个最小声明测试数据：host.ts 从 ./lib/a.ts 值导入。 */
async function typesFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "build-types-"));
  await mkdir(path.join(root, "lib"));
  await writeFile(path.join(root, "lib", "a.ts"), "export const a = 1;\n", "utf8");
  await writeFile(
    path.join(root, "host.ts"),
    'export { a } from "./lib/a.ts";\nexport const b = 1;\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "tsconfig.types.json"),
    JSON.stringify({
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        allowImportingTsExtensions: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        skipLibCheck: true,
      },
      include: ["host.ts", "lib/**/*.ts"],
    }),
    "utf8",
  );
  return root;
}

describe("buildDeclarations", () => {
  it("成功：清单、改写与目录替换", async () => {
    const root = await typesFixture();
    try {
      const files = await buildDeclarations({ root, tscEntry: tscEntryOf() });
      assert.deepEqual(files.toSorted(), [...EXPECTED_DECLS]);
      const hostDecl = await readFile(path.join(root, "types", "host.d.ts"), "utf8");
      assert.ok(hostDecl.includes('from "./lib/a.js"'), `说明符未改写：\n${hostDecl}`);
      assert.ok(!hostDecl.includes('from "./lib/a.ts"'));
      assert.equal(existsSync(path.join(root, ".tmp", "types")), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("失败：草稿被清，上一轮 types/ 原样保留", async () => {
    const root = await typesFixture();
    // 造一个必然的类型错误：导入不存在的成员。
    await writeFile(
      path.join(root, "host.ts"),
      'import { a } from "./lib/missing.ts";\nexport const b = a;\n',
      "utf8",
    );
    await mkdir(path.join(root, "types"));
    await writeFile(path.join(root, "types", "sentinel.d.ts"), "export {};\n", "utf8");
    try {
      await assert.rejects(buildDeclarations({ root, tscEntry: tscEntryOf() }), /TS2307|missing/u);
      assert.equal(existsSync(path.join(root, ".tmp", "types")), false);
      const kept = await readdir(path.join(root, "types"));
      assert.deepEqual(kept, ["sentinel.d.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("自定义 outDir / scratch / tsconfig 生效", async () => {
    const root = await typesFixture();
    const altOut = path.join(root, "decls");
    const altScratch = path.join(root, "draft");
    try {
      const files = await buildDeclarations({
        root,
        tscEntry: tscEntryOf(),
        tsconfig: "tsconfig.types.json",
        outDir: altOut,
        scratch: altScratch,
      });
      assert.deepEqual(files.toSorted(), [...EXPECTED_DECLS]);
      assert.equal(existsSync(altOut), true);
      assert.equal(existsSync(altScratch), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
