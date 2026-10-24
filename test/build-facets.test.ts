// test/build-facets.test.ts —— host / client 两条统一构建编排（lib/build-host.ts 与
// lib/build-client.ts）的行为面。
//
// rolldown 用受控桩代替：这里测的是**编排**（外部化口径、传给 rolldown 的选项、输出守卫、
// 正典化与外壳拼装），不是打包器本身；桩可以精确交出坏形状（多 chunk、空正文、缺
// moduleIds），那正是各包脚本此前各自漏测的负形状。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHostEntries } from "../lib/build-host.ts";
import {
  buildClientBundle,
  collapseStorePaths,
  REACT_RUNTIME_MODULES,
} from "../lib/build-client.ts";
import type { HostEntry } from "../lib/build-host.ts";
import type { ClientNameContext } from "../lib/build-client.ts";
import type { OutputItem, RolldownBundle, RolldownFactory } from "../lib/build-artifacts.ts";

/** 复用的高频字面量（sonarjs/no-duplicate-string 的去重面）。 */
const HEADER = "// h";
const HOST_HEADER = "// GENERATED-header\n";
const HOST_ENTRY_SOURCE = "host.ts";
const CLIENT_ENTRY_REL = path.join("src", "client-entry.ts");
const MODULE_IDS = ["/pkg/lib/a.ts"] as const;
const FIXTURE_NAME = "@jayyuen66/fixture";
const CLOSE_BOOM = "close boom";

/** 桩记录到的 rolldown 选项视图（只列断言要读的键；写死形状避免索引签名上的访问规则冲突）。 */
interface RolldownOptionsView {
  input?: string | string[];
  platform?: string;
  cwd?: string;
  resolve?: { extensions: string[] };
  external?: (id: string) => boolean;
  plugins?: unknown[];
}

/** 一次 rolldown 调用的记录。 */
interface RolldownCall {
  readonly options: RolldownOptionsView;
  generateOptions: Record<string, unknown>;
  closed: boolean;
}

/** 桩工厂的行为配置。 */
interface StubPlan {
  /** 每次 rolldown 调用各交回的输出清单（按调用序取用；取尽后重复末项）。 */
  readonly outputs: readonly (readonly OutputItem[])[];
  readonly generateError?: Error;
  readonly closeError?: Error;
}

/**
 * 取唯一一次调用的记录。
 * @param calls - 桩的调用记录
 * @returns 那一条记录
 */
function soleCall(calls: readonly RolldownCall[]): RolldownCall {
  const [call] = calls;
  if (call === undefined) {
    assert.fail("rolldown 未被调用");
  }
  return call;
}

/**
 * 取记录里的外部化判据。
 * @param call - 桩的调用记录
 * @returns external 函数
 */
function externalOf(call: RolldownCall): (id: string) => boolean {
  const { external } = call.options;
  if (external === undefined) {
    assert.fail("external 判据缺席");
  }
  return external;
}

/**
 * 造一个记录型的 rolldown 桩。
 * @param plan - 行为配置
 * @returns 工厂与调用记录
 */
function stubRolldown(plan: StubPlan): { factory: RolldownFactory; calls: RolldownCall[] } {
  const calls: RolldownCall[] = [];
  const factory: RolldownFactory = async (options) => {
    const call: RolldownCall = {
      options: options as RolldownOptionsView,
      generateOptions: {},
      closed: false,
    };
    calls.push(call);
    const index = calls.length - 1;
    const bundle: RolldownBundle = {
      // 与真实 bundle 的形状兼容（见 RolldownBundle 的属性式签名）。
      generate: async (generateOptions: {
        format: "esm" | "cjs";
        minify?: boolean;
        comments?: boolean;
      }) => {
        call.generateOptions = generateOptions;
        if (plan.generateError !== undefined) {
          throw plan.generateError;
        }
        const output = plan.outputs[Math.min(index, plan.outputs.length - 1)] ?? [];
        return { output };
      },
      close: async () => {
        call.closed = true;
        if (plan.closeError !== undefined) {
          throw plan.closeError;
        }
      },
    };
    return bundle;
  };
  return { factory, calls };
}

/** 一个最小可用的 entry chunk。 */
function chunkOf(code = "export {};", moduleIds: readonly string[] = [...MODULE_IDS]): OutputItem {
  return { type: "chunk", fileName: "entry.js", isEntry: true, code, moduleIds };
}

/** 带依赖表的临时包根。 */
async function fixtureRoot(manifest: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "build-facets-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify(manifest), "utf8");
  return dir;
}

/** 默认夹具 manifest：一条普通依赖 + 一条可选依赖。 */
const BASE_MANIFEST = {
  name: FIXTURE_NAME,
  dependencies: { "@jayyuen66/dsh-plugin-shared": "0.1.7" },
  optionalDependencies: { "@jayyuen66/optional-pkg": "1.0.0" },
};

/** 单入口配置。 */
const HOST_ENTRIES: readonly HostEntry[] = [
  { source: HOST_ENTRY_SOURCE, output: "host.js", header: HOST_HEADER },
];

/** 造一条带 pnpm store 段的 region 行（sep 用 Windows 反斜杠形态）。 */
function storeLine(prefix: string, sep: string): string {
  return `//#region ${prefix}node_modules${sep}.pnpm${sep}@scope+pkg@1.0.0_h1${sep}node_modules${sep}@scope/pkg/lib/a.js`;
}

/** 用完即弃的夹具包根清理。 */
async function cleanup(...roots: readonly string[]): Promise<void> {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

describe("buildHostEntries", () => {
  it("单入口：产物 = 头 + 正典化正文；选项按缺省值下发", async () => {
    const { factory, calls } = stubRolldown({
      outputs: [[chunkOf("//#region ../lib/a.ts\nexport {};")]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES });
      assert.equal(artifacts.length, 1);
      const [artifact] = artifacts;
      if (artifact === undefined) {
        assert.fail("artifacts 为空");
      }
      assert.equal(artifact.code, `${HOST_HEADER}//#region lib/a.ts\nexport {};\n`);
      assert.equal(artifact.file, path.join(root, "host.js"));
      assert.deepEqual(artifact.inlinedModules, MODULE_IDS);

      const call = soleCall(calls);
      assert.equal(call.options.platform, "node");
      assert.equal(call.options.cwd, root);
      assert.deepEqual(call.options.resolve?.extensions, [".ts", ".mjs", ".js"]);
      assert.equal(call.options.plugins, undefined);
      assert.deepEqual(call.generateOptions, { format: "esm" });
      assert.equal(call.closed, true);
    } finally {
      await cleanup(root);
    }
  });

  it("外部化按包名段：子路径命中、可选依赖默认外部化、未声明包不外置", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES });
      const external = externalOf(soleCall(calls));
      assert.equal(external("@jayyuen66/dsh-plugin-shared/lib/text"), true);
      assert.equal(external("@jayyuen66/optional-pkg"), true);
      assert.equal(external("typescript"), false);
      assert.equal(external("lodash/fp"), false);
    } finally {
      await cleanup(root);
    }
  });

  it("externalizeOptional=false：可选依赖不外置", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({
        root,
        rolldown: factory,
        entries: HOST_ENTRIES,
        externalizeOptional: false,
      });
      const external = externalOf(soleCall(calls));
      assert.equal(external("@jayyuen66/optional-pkg"), false);
      assert.equal(external("@jayyuen66/dsh-plugin-shared"), true);
    } finally {
      await cleanup(root);
    }
  });

  it("多入口：各自单独一次 rolldown，产物序与入口序一致", async () => {
    const { factory, calls } = stubRolldown({
      outputs: [[chunkOf("export 'host';")], [chunkOf("export 'settings';")]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildHostEntries({
        root,
        rolldown: factory,
        entries: [
          ...HOST_ENTRIES,
          { source: "settings-host.ts", output: "settings.js", header: "// h2\n" },
        ],
      });
      assert.equal(calls.length, 2);
      assert.equal(calls[1]?.options.input, path.join(root, "settings-host.ts"));
      assert.deepEqual(
        artifacts.map((artifact) => artifact.output),
        ["host.js", "settings.js"],
      );
    } finally {
      await cleanup(root);
    }
  });

  it("minify 与 comments 的缺省联动与显式覆盖", async () => {
    const minified = stubRolldown({ outputs: [[chunkOf()]] });
    const bothGiven = stubRolldown({ outputs: [[chunkOf()]] });
    const extensionsAndPlugins = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({
        root,
        rolldown: minified.factory,
        entries: HOST_ENTRIES,
        minify: true,
      });
      await buildHostEntries({
        root,
        rolldown: bothGiven.factory,
        entries: HOST_ENTRIES,
        minify: true,
        comments: true,
      });
      await buildHostEntries({
        root,
        rolldown: extensionsAndPlugins.factory,
        entries: HOST_ENTRIES,
        resolveExtensions: [".ts", ".json"],
        plugins: [{ name: "p" }],
      });
      assert.deepEqual(soleCall(minified.calls).generateOptions, {
        format: "esm",
        minify: true,
        comments: false,
      });
      assert.deepEqual(soleCall(bothGiven.calls).generateOptions, {
        format: "esm",
        minify: true,
      });
      const { resolve, plugins } = soleCall(extensionsAndPlugins.calls).options;
      assert.deepEqual(resolve?.extensions, [".ts", ".json"]);
      assert.deepEqual(plugins, [{ name: "p" }]);
    } finally {
      await cleanup(root);
    }
  });

  it("manifest 坏形状：依赖表非对象 / 条目值非字符串 / 外部化集合为空", async () => {
    const stub = stubRolldown({ outputs: [[chunkOf()]] });
    const arrayTable = await fixtureRoot({ ...BASE_MANIFEST, dependencies: [] });
    const badValue = await fixtureRoot({
      ...BASE_MANIFEST,
      dependencies: { "@jayyuen66/dsh-plugin-shared": { bad: "shape" } },
    });
    const stringTable = await fixtureRoot({ ...BASE_MANIFEST, dependencies: "not-an-object" });
    const empty = await fixtureRoot({ name: FIXTURE_NAME });
    try {
      await assert.rejects(
        buildHostEntries({ root: arrayTable, rolldown: stub.factory, entries: HOST_ENTRIES }),
        /dependencies 不是对象/u,
      );
      await assert.rejects(
        buildHostEntries({ root: stringTable, rolldown: stub.factory, entries: HOST_ENTRIES }),
        /不是对象（实为 string）/u,
      );
      await assert.rejects(
        buildHostEntries({ root: badValue, rolldown: stub.factory, entries: HOST_ENTRIES }),
        /不是字符串范围/u,
      );
      await assert.rejects(
        buildHostEntries({ root: empty, rolldown: stub.factory, entries: HOST_ENTRIES }),
        /外部化集合为空/u,
      );
    } finally {
      await cleanup(arrayTable, stringTable, badValue, empty);
    }
  });

  it("结构性判据：moduleIds 缺席 / 空表 / 非字符串元素都拒绝", async () => {
    const root = await fixtureRoot(BASE_MANIFEST);
    const cases: readonly (readonly string[] | undefined)[] = [
      undefined,
      [],
      ["ok", 5 as unknown as string],
    ];
    try {
      await Promise.all(
        cases.map(async (moduleIds) => {
          const stub = stubRolldown({
            outputs: [[{ ...chunkOf(), moduleIds }]],
          });
          await assert.rejects(
            buildHostEntries({ root, rolldown: stub.factory, entries: HOST_ENTRIES }),
            /moduleIds/u,
          );
        }),
      );
    } finally {
      await cleanup(root);
    }
  });

  it("输出守卫：多输出与空正文拒绝", async () => {
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const multi = stubRolldown({ outputs: [[chunkOf(), chunkOf("export 'b';")]] });
      await assert.rejects(
        buildHostEntries({ root, rolldown: multi.factory, entries: HOST_ENTRIES }),
        /2 项输出/u,
      );
      const blank = stubRolldown({ outputs: [[chunkOf("   ")]] });
      await assert.rejects(
        buildHostEntries({ root, rolldown: blank.factory, entries: HOST_ENTRIES }),
        /带正文/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("generate 抛错：bundle 仍被释放，错因原样上抛", async () => {
    const boom = new Error("generate boom");
    const { factory, calls } = stubRolldown({ outputs: [[]], generateError: boom });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES }),
        /generate boom/u,
      );
      assert.equal(soleCall(calls).closed, true);
    } finally {
      await cleanup(root);
    }
  });

  it("异常路径上 close 也失败：释放噪音不顶掉原始错因", async () => {
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args.map(String).join(" "));
    };
    const boom = new Error("generate boom");
    const { factory } = stubRolldown({
      outputs: [[]],
      generateError: boom,
      closeError: new Error(CLOSE_BOOM),
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES }),
        /generate boom/u,
      );
    } finally {
      console.error = original;
      await cleanup(root);
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /释放 rolldown bundle 失败/u);
  });

  it("成功路径上 close 失败：判红（资源没释放是构建器的问题）", async () => {
    const { factory } = stubRolldown({
      outputs: [[chunkOf()]],
      closeError: new Error(CLOSE_BOOM),
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES }),
        /close boom/u,
      );
    } finally {
      await cleanup(root);
    }
  });
});

describe("buildClientBundle", () => {
  it("外壳形状：头、id、指令序言与收尾；缺省选项下发", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf("module.exports = 1;")]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const out = await buildClientBundle({
        root,
        rolldown: factory,
        header: "// GENERATED-client",
      });
      assert.ok(out.startsWith("// GENERATED-client\nwindow.__ModuleLoader__.load({\n"));
      assert.ok(out.includes('  id: "@jayyuen66/fixture",'));
      assert.ok(out.includes("    'use strict';"));
      assert.ok(out.endsWith("  },\n});\n"));

      const call = soleCall(calls);
      assert.equal(call.options.input, path.join(root, CLIENT_ENTRY_REL));
      assert.equal(call.options.platform, "browser");
      assert.equal(call.options.cwd, root);
      assert.deepEqual(call.options.resolve?.extensions, [
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".mjs",
        ".json",
      ]);
      assert.deepEqual(call.generateOptions, { format: "cjs" });
      assert.equal(call.closed, true);
    } finally {
      await cleanup(root);
    }
  });

  it("外置：登记的精确说明符外置，react 家族未登记的构建期失败，其余内联", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildClientBundle({ root, rolldown: factory, header: HEADER });
      const external = externalOf(soleCall(calls));
      assert.equal(external("react"), true);
      assert.equal(external("react-dom/client"), true);
      assert.equal(external("lodash"), false);
      assert.throws(() => external("react-dom/server"), /react 家族/u);
      assert.throws(() => external("react/jsx-dev-runtime"), /react 家族/u);
    } finally {
      await cleanup(root);
    }
  });

  it("自定义外置清单：非 react 家族也能登记", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildClientBundle({
        root,
        rolldown: factory,
        header: HEADER,
        externals: [...REACT_RUNTIME_MODULES, "@deepseek-ai/cordis"],
      });
      const external = externalOf(soleCall(calls));
      assert.equal(external("@deepseek-ai/cordis"), true);
      assert.equal(external("lodash"), false);
    } finally {
      await cleanup(root);
    }
  });

  it("自定义入口与 minify/comments 覆盖", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildClientBundle({
        root,
        rolldown: factory,
        header: HEADER,
        entry: "src/alt-entry.ts",
        minify: true,
      });
      const call = soleCall(calls);
      assert.equal(call.options.input, path.join(root, "src", "alt-entry.ts"));
      assert.deepEqual(call.generateOptions, { format: "cjs", minify: true, comments: false });
    } finally {
      await cleanup(root);
    }
  });

  it("store 路径折叠：相对前缀、反斜杠与中段形态都折到 node_modules/ 一层", async () => {
    const code = [storeLine("../../", "/"), storeLine("", "\\"), "export {};"].join("\n");
    const { factory } = stubRolldown({ outputs: [[chunkOf(code)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const out = await buildClientBundle({ root, rolldown: factory, header: HEADER });
      assert.ok(!out.includes(".pnpm"), `折叠后不应再有 store 段：\n${out}`);
      assert.equal(
        [...out.matchAll(/^\/\/#region node_modules\/@scope\/pkg\/lib\/a\.js$/gmu)].length,
        2,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("折叠兜底：region 行形态之外残留 store 段即失败", async () => {
    const { factory } = stubRolldown({
      outputs: [[chunkOf('const p = "node_modules/.pnpm/leak/node_modules/";\nexport {};')]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /仍有 pnpm store 路径未折叠/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("collapseStorePaths 单测：干净输入原样通过", () => {
    const clean = "//#region node_modules/@scope/pkg/lib/a.js\nexport {};";
    assert.equal(collapseStorePaths(clean), clean);
  });

  it("包名缺失 / 空串 / 字符集不合法：构建前失败，rolldown 不被调用", async () => {
    const missing = await fixtureRoot({});
    const empty = await fixtureRoot({ name: "" });
    const badCharset = await fixtureRoot({ name: "Bad Name" });
    const { factory, calls } = stubRolldown({ outputs: [[]] });
    try {
      await assert.rejects(
        buildClientBundle({ root: missing, rolldown: factory, header: HEADER }),
        /name 缺失或非字符串/u,
      );
      await assert.rejects(
        buildClientBundle({ root: empty, rolldown: factory, header: HEADER }),
        /name 缺失或非字符串/u,
      );
      await assert.rejects(
        buildClientBundle({ root: badCharset, rolldown: factory, header: HEADER }),
        /npm 包名字符集/u,
      );
      assert.equal(calls.length, 0);
    } finally {
      await cleanup(missing, empty, badCharset);
    }
  });

  it("verifyName 钩子：拿到包名、折叠后的正文与读源文件的通道", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf('const BUNDLE_PKG = "x";')]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, CLIENT_ENTRY_REL),
      "// placeholder entry\nexport {};\n",
      "utf8",
    );
    let captured: ClientNameContext | undefined;
    try {
      await buildClientBundle({
        root,
        rolldown: factory,
        header: HEADER,
        verifyName: async (context) => {
          captured = context;
          const source = await context.readSource(CLIENT_ENTRY_REL);
          assert.ok(source.includes("placeholder"));
        },
      });
      if (captured === undefined) {
        assert.fail("verifyName 未被调用");
      }
      assert.equal(captured.pkgName, FIXTURE_NAME);
      assert.ok(captured.body.includes('const BUNDLE_PKG = "x";'));
    } finally {
      await cleanup(root);
    }
  });

  it("verifyName 抛错：构建失败", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({
          root,
          rolldown: factory,
          header: HEADER,
          verifyName: () => {
            throw new Error("name drift");
          },
        }),
        /name drift/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("generate 抛错：bundle 仍被释放", async () => {
    const boom = new Error("client generate boom");
    const { factory, calls } = stubRolldown({ outputs: [[]], generateError: boom });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /client generate boom/u,
      );
      assert.equal(soleCall(calls).closed, true);
    } finally {
      await cleanup(root);
    }
  });

  it("成功路径上 close 失败：判红", async () => {
    const { factory } = stubRolldown({
      outputs: [[chunkOf()]],
      closeError: new Error(CLOSE_BOOM),
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /close boom/u,
      );
    } finally {
      await cleanup(root);
    }
  });
});
