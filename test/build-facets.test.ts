// test/build-facets.test.ts —— host / client 两条统一构建编排（lib/build-host.ts 与
// lib/build-client.ts）的行为测试。
//
// rolldown 用受控 stub 代替：这里测的是**编排**（外部化规则、传给 rolldown 的选项、输出检查、
// 规范化与 外壳 拼装），不是打包器本身；stub 可以精确交出坏形状（多 chunk、空正文、缺
// moduleIds），那正是各包脚本此前各自漏测的负形状。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHostEntries } from "../lib/build-host.ts";
import {
  buildClientArtifacts as buildClientArtifactsRaw,
  buildClientBundle as buildClientBundleRaw,
  clientExternalPatterns,
  clientExternalPredicate,
  clientReactGuard,
  collapseStorePaths,
  REACT_RUNTIME_MODULES,
} from "../lib/build-client.ts";
import { parseAst } from "rolldown/parseAst";
import type { HostEntry } from "../lib/build-host.ts";
import type {
  ClientArtifact,
  ClientBuildOptions,
  ClientChunkSpec,
  ClientNameContext,
} from "../lib/build-client.ts";
import type { CommentsOptions } from "rolldown";
import type { ParseSourceAst } from "../lib/decorator-lowering.ts";
import type { OutputItem, RolldownBundle, RolldownFactory } from "../lib/build-artifacts.ts";

/** 复用的高频字面量（sonarjs/no-duplicate-string 的去重范围）。 */
const HEADER = "// h";
const HOST_HEADER = "// GENERATED-header\n";
const HOST_ENTRY_SOURCE = "host.ts";
const CLIENT_ENTRY_REL = path.join("src", "client-entry.ts");
const MODULE_IDS = ["/pkg/lib/a.ts"] as const;
const FIXTURE_NAME = "@jayyuen66/fixture";
const CLOSE_BOOM = "close boom";
const ENTRY_BODY = "module.exports = 1;";
const CHUNK_BODY = "module.exports = 2;";
/** 测试里反复出现的常量（sonarjs/no-duplicate-string 的去重范围）。 */
const SHARED = "@jayyuen66/dsh-plugin-shared";
const SHARED_CLIENT = `${SHARED}/client`;
const SHARED_TOOL = `${SHARED}/tool`;
const REACT_DOM_SUBDIR = "react-dom/client";
const REACT_DOM_SERVER = "react-dom/server";
const CLIENT_EXTRA = [SHARED_CLIENT, "zod"] as const;
/** 压缩产物的注释档位（与实现同源的三档）。 */
const LEGAL_COMMENTS = { legal: true, annotation: false, jsdoc: false } as const;

/** 测试统一注入真解析器：require 闸门读 AST，不再是文本扫描。 */
const parseClientBody: ParseSourceAst = (code, id) => parseAst(code, { lang: "js" }, id);

/**
 * 注入解析器的 buildClientBundle。缺解析器那条负例直接用 Raw 版本。
 * @param options - 除解析器之外的构建配置
 * @returns 产物正文
 */
async function buildClientBundle(options: Omit<ClientBuildOptions, "parseAst">): Promise<string> {
  return buildClientBundleRaw({ ...options, parseAst: parseClientBody });
}

/**
 * 注入解析器的 buildClientArtifacts。缺解析器那条负例直接用 Raw 版本。
 * @param options - 除解析器之外的构建配置与 chunk 声明
 * @returns 产物清单
 */
async function buildClientArtifacts(
  options: Omit<ClientBuildOptions, "parseAst"> & { readonly chunks?: readonly ClientChunkSpec[] },
): Promise<readonly ClientArtifact[]> {
  return buildClientArtifactsRaw({ ...options, parseAst: parseClientBody });
}

/** stub 记录到的 rolldown 选项视图（只列断言要读的键；写死形状避免索引签名上的访问规则冲突）。 */
interface RolldownOptionsView {
  input?: string | string[];
  platform?: string;
  cwd?: string;
  resolve?: { extensions: string[] };
  external?: readonly RegExp[];
  plugins?: readonly unknown[];
}

/** 一次 rolldown 调用的记录。 */
interface RolldownCall {
  readonly options: RolldownOptionsView;
  generateOptions: Record<string, unknown>;
  closed: boolean;
}

/** 守卫插件的 resolveId 视图（只列断言要读的位；类型形状由 rolldown 保证）。 */
interface GuardResolveId {
  readonly filter?: { readonly id?: RegExp };
  readonly handler: (this: never, id: string) => unknown;
}

/** stub 工厂的行为配置。 */
interface StubPlan {
  /** 每次 rolldown 调用各交回的输出清单（按调用序取用；取尽后重复末项）。 */
  readonly outputs: readonly (readonly OutputItem[])[];
  readonly generateError?: Error;
  readonly closeError?: Error;
}

/**
 * 取唯一一次调用的记录。
 * @param calls - stub 的调用记录
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
 * 判一条说明符会不会被 external 正则数组命中（与 rolldown 的 StringOrRegex 语义对齐：
 * 正则按 `matches` 测，即「在串里找得到」）。
 * @param call - 桩的调用记录
 * @param id - 说明符
 * @returns 是否外置
 */
function externalMatches(call: RolldownCall, id: string): boolean {
  const { external } = call.options;
  if (external === undefined) {
    assert.fail("external 判据缺席");
  }
  if (typeof external === "function") {
    assert.fail("external 应为正则数组（函数形态每次回调 JS，官方文档点名开销显著）");
  }
  return external.some((pattern) => pattern.test(id));
}

/**
 * 取记录里的 react 家族守卫插件。
 * @param call - 桩的调用记录
 * @returns 守卫插件的 resolveId 钩子
 */
function reactGuardOf(call: RolldownCall): (id: string) => unknown {
  const plugin = call.options.plugins?.find(
    (item): item is { name: string; resolveId: { handler: (id: string) => unknown } } =>
      typeof item === "object" &&
      item !== null &&
      (item as { name?: unknown }).name === "dsh-react-family-guard",
  );
  if (plugin === undefined) {
    assert.fail("react 家族守卫插件缺席");
  }
  return plugin.resolveId.handler;
}

/**
 * 造一个记录型的 rolldown stub。
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
        comments?: boolean | CommentsOptions;
        codeSplitting?: boolean;
        dynamicImportInCjs?: boolean;
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

/** 默认测试数据 manifest：一条普通依赖 + 一条可选依赖。 */
const BASE_MANIFEST = {
  name: FIXTURE_NAME,
  dependencies: { [SHARED]: "0.1.7" },
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

/** 用完即弃的测试包根清理。 */
async function cleanup(...roots: readonly string[]): Promise<void> {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

describe("buildHostEntries", () => {
  it("单入口：产物 = 头 + 原正文；选项按缺省值下发且不做文本后处理", async () => {
    const { factory, calls } = stubRolldown({
      outputs: [[chunkOf("// ../lib/a.ts\nexport {};")]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildHostEntries({ root, rolldown: factory, entries: HOST_ENTRIES });
      assert.equal(artifacts.length, 1);
      const [artifact] = artifacts;
      if (artifact === undefined) {
        assert.fail("artifacts 为空");
      }
      assert.equal(artifact.code, `${HOST_HEADER}// ../lib/a.ts\nexport {};\n`);
      assert.equal(artifact.file, path.join(root, "host.js"));
      assert.deepEqual(artifact.inlinedModules, MODULE_IDS);

      const call = soleCall(calls);
      assert.equal(call.options.platform, "node");
      assert.equal(call.options.cwd, root);
      assert.deepEqual(call.options.resolve?.extensions, [".ts", ".mjs", ".js"]);
      assert.equal(call.options.plugins, undefined);
      assert.deepEqual(call.generateOptions, {
        format: "esm",
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
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
      const call = soleCall(calls);
      assert.equal(externalMatches(call, SHARED_TOOL), true);
      assert.equal(externalMatches(call, SHARED_CLIENT), true);
      assert.equal(externalMatches(call, "@jayyuen66/optional-pkg"), true);
      assert.equal(externalMatches(call, "typescript"), false);
      assert.equal(externalMatches(call, "lodash/fp"), false);
      // 包名边界：前缀相同的另一个包不能被顺手外置成宿主模块表里不存在的键。
      assert.equal(externalMatches(call, "@jayyuen66/optional-pkg-extra"), false);
      assert.equal(externalMatches(call, "@jayyuen66/dsh-plugin-sharedx"), false);
    } finally {
      await cleanup(root);
    }
  });

  it("inline 子路径：只放行点名那一条，同包其余子路径与包根仍外置", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({
        root,
        rolldown: factory,
        entries: HOST_ENTRIES,
        inline: [SHARED_TOOL],
      });
      const call = soleCall(calls);
      assert.equal(externalMatches(call, SHARED_TOOL), false);
      assert.equal(externalMatches(call, SHARED_CLIENT), true);
      assert.equal(externalMatches(call, SHARED), true);
    } finally {
      await cleanup(root);
    }
  });

  it("inline 整包：包根与全部子路径一起交给打包器", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({
        root,
        rolldown: factory,
        entries: HOST_ENTRIES,
        inline: [SHARED],
      });
      const call = soleCall(calls);
      assert.equal(externalMatches(call, SHARED), false);
      assert.equal(externalMatches(call, SHARED_CLIENT), false);
    } finally {
      await cleanup(root);
    }
  });

  it("inline 未声明：构建前立即拒绝，不退化成整包仍 external", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildHostEntries({
          root,
          rolldown: factory,
          entries: HOST_ENTRIES,
          inline: ["@jayyuen66/not-a-dependency/tool"],
        }),
        /不属于依赖段/u,
      );
      // 另一档错误文案（不列 optionalDependencies）也要走到：两个分支都只用于解释拒绝原因。
      await assert.rejects(
        buildHostEntries({
          root,
          rolldown: factory,
          entries: HOST_ENTRIES,
          inline: ["@jayyuen66/not-a-dependency/tool"],
          externalizeOptional: false,
        }),
        /不属于依赖段/u,
      );
      assert.equal(calls.length, 0);
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
      const call = soleCall(calls);
      assert.equal(externalMatches(call, "@jayyuen66/optional-pkg"), false);
      assert.equal(externalMatches(call, SHARED), true);
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
        comments: LEGAL_COMMENTS,
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
      // 显式 comments: true 是调用方的明确要求：保持旧行为，省略这个键（rolldown 缺省全留）。
      assert.deepEqual(soleCall(bothGiven.calls).generateOptions, {
        format: "esm",
        minify: true,
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
      const { resolve, plugins } = soleCall(extensionsAndPlugins.calls).options;
      assert.deepEqual(resolve?.extensions, [".ts", ".json"]);
      assert.deepEqual(plugins, [{ name: "p" }]);
    } finally {
      await cleanup(root);
    }
  });

  it("显式 comments: false 抹掉全部注释（压缩态也不保留法律注释）", async () => {
    // 三态里唯一会丢许可头的一档，因此必须是**显式**要求：调用方自己承担第三方许可的披露。
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildHostEntries({
        root,
        rolldown: factory,
        entries: HOST_ENTRIES,
        minify: true,
        comments: false,
      });
      assert.deepEqual(soleCall(calls).generateOptions, {
        format: "esm",
        minify: true,
        comments: false,
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
    } finally {
      await cleanup(root);
    }
  });

  it("manifest 坏形状：依赖表非对象 / 条目值非字符串 / 外部化集合为空", async () => {
    const stub = stubRolldown({ outputs: [[chunkOf()]] });
    const arrayTable = await fixtureRoot({ ...BASE_MANIFEST, dependencies: [] });
    const badValue = await fixtureRoot({
      ...BASE_MANIFEST,
      dependencies: { [SHARED]: { bad: "shape" } },
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
  it("外壳 形状：头、id、指令序言与收尾；缺省选项下发", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf(ENTRY_BODY)]] });
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
      assert.deepEqual(call.generateOptions, {
        format: "cjs",
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
      assert.equal(call.closed, true);
    } finally {
      await cleanup(root);
    }
  });

  it("外置：非 react 说明符按包名边界外置，react 家族交给 resolveId 守卫", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildClientBundle({ root, rolldown: factory, header: HEADER });
      const call = soleCall(calls);
      // react 家族不进 external 数组：正则在 isResolved 之前命中就不再问插件，未登记的子路径
      // 会被静默外置。它们全部由守卫插件处理。
      assert.equal(externalMatches(call, "react"), false);
      assert.equal(externalMatches(call, REACT_DOM_SUBDIR), false);
      assert.equal(externalMatches(call, "lodash"), false);
      const guard = reactGuardOf(call);
      assert.deepEqual(guard("react"), { id: "react", external: true });
      assert.deepEqual(guard(REACT_DOM_SUBDIR), { id: REACT_DOM_SUBDIR, external: true });
      assert.throws(() => guard(REACT_DOM_SERVER), /react 家族/u);
      assert.throws(() => guard("react/jsx-dev-runtime"), /react 家族/u);
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
      const call = soleCall(calls);
      assert.equal(externalMatches(call, "@deepseek-ai/cordis"), true);
      assert.equal(externalMatches(call, "@deepseek-ai/cordis/plugin"), true);
      assert.equal(externalMatches(call, "lodash"), false);
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
      assert.deepEqual(call.generateOptions, {
        format: "cjs",
        minify: true,
        comments: LEGAL_COMMENTS,
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
    } finally {
      await cleanup(root);
    }
  });

  it("client 显式 comments: false：连法律注释一起抹掉", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await buildClientBundle({
        root,
        rolldown: factory,
        header: HEADER,
        minify: true,
        comments: false,
      });
      assert.deepEqual(soleCall(calls).generateOptions, {
        format: "cjs",
        minify: true,
        comments: false,
        codeSplitting: false,
        dynamicImportInCjs: false,
      });
    } finally {
      await cleanup(root);
    }
  });

  it("store 路径折叠（collapseStorePaths）：相对前缀、反斜杠与中段形态都折到 node_modules/ 一层", async () => {
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

  it("collapseStorePaths 单测：`// ` 模块横幅的 store 段同样折叠（registry 安装形态）", () => {
    const banner =
      "// node_modules/.pnpm/@scope+pkg@1.0.0_peer@2.0.0/node_modules/@scope/pkg/dist/a.js";
    assert.equal(collapseStorePaths(banner), "// node_modules/@scope/pkg/dist/a.js");
  });

  it("collapseStorePaths 单测：横幅与 region 各保其前缀；`../` 前缀与反斜杠同样处理", () => {
    assert.equal(
      collapseStorePaths("// ../node_modules/.pnpm/x@1.2.3_a/node_modules/x/b.js"),
      "// node_modules/x/b.js",
    );
    assert.equal(
      collapseStorePaths(String.raw`//#region ..\node_modules\.pnpm\x@1.2.3_a\node_modules\x\b.js`),
      "//#region node_modules/x/b.js",
    );
  });

  it("collapseStorePaths 单测：非注释行携带 .pnpm 串仍然判红（兜底不因扩大范围放松）", () => {
    assert.throws(
      () => collapseStorePaths("const p = 'node_modules/.pnpm/x@1/node_modules/x';"),
      /未折叠/u,
    );
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

describe("clientExternalPredicate（各包构建脚本的自查视图）", () => {
  const REGISTERED = [...REACT_RUNTIME_MODULES, ...CLIENT_EXTRA];
  const isExternal = clientExternalPredicate(REGISTERED);

  it("与构建同一份接受度：只有逐字登记过的说明符放行", () => {
    assert.equal(isExternal("zod"), true);
    // `zod` 是裸包名登记，外置规则会命中 `zod/v4`；但宿主模块表没有这一条，产物闸门会让
    // 构建失败。自查视图必须与接受度一致，而不是与「会被外置」一致。
    assert.throws(() => isExternal("zod/v4"), /没有逐字登记/u);
    assert.equal(isExternal(SHARED_CLIENT), true);
    // 子路径登记项不泛化成整个包：宿主模块表按说明符全等查键，`/tool` 没有登记就
    // 不该外置（外置出去就是一条加载期必然 miss 的 require）。
    assert.equal(isExternal(SHARED_TOOL), false);
    assert.equal(isExternal("lodash"), false);
    assert.equal(isExternal("./local.ts"), false);
  });

  it("react 家族：登记的放行，未登记抛错（不静默返回 false）", () => {
    assert.equal(isExternal("react"), true);
    assert.equal(isExternal(REACT_DOM_SUBDIR), true);
    assert.throws(() => isExternal(REACT_DOM_SERVER), /不在外置清单/u);
    assert.throws(() => isExternal("react/jsx-dev-runtime"), /不在外置清单/u);
  });
});

describe("clientExternalPatterns / clientReactGuard", () => {
  it("react 家族被剔除出 external 数组，裸包名泛化、子路径精确匹配", () => {
    const patterns = clientExternalPatterns([
      ...REACT_RUNTIME_MODULES,
      "zod",
      "zod/v4",
      SHARED_CLIENT,
    ]);
    const sources = patterns.map((pattern) => pattern.source);
    assert.ok(
      sources.every((source) => !source.includes("react")),
      sources.join(" "),
    );
    // 去重按**登记项字面**做，不按匹配面做：`zod` 与 `zod/v4` 是两条不同的登记项，
    // 前者泛化出的包名边界虽然已经覆盖后者，但两条都留着才与「登记了什么就外置什么」一致。
    assert.equal(sources.filter((source) => source.startsWith("^zod")).length, 2);
    // 正则源码里 `/` 会被转义（RegExp.prototype.source 的既有行为），断言按源码写。
    assert.ok(sources.includes(String.raw`^zod(?:\/|$)`), sources.join(" "));
    // 子路径登记项精确匹配：泛化成整包会把没登记的兄弟子路径也外置出去。
    assert.ok(
      sources.includes(String.raw`^@jayyuen66\/dsh-plugin-shared\/client$`),
      sources.join(" "),
    );
    assert.ok(
      !sources.some((source) => source.includes(String.raw`dsh-plugin-shared(?:\/|$)`)),
      "shared 只登记了 /client 子路径，不得泛化成整个包名",
    );
  });

  it("守卫的 filter.id 只放 react 家族进来，handler 逐字核对登记集", () => {
    const guard = clientReactGuard([...REACT_RUNTIME_MODULES, "zod"]);
    const resolveId = guard.resolveId as GuardResolveId | undefined;
    if (resolveId === undefined || typeof resolveId === "function") {
      assert.fail("守卫必须以对象形态声明 resolveId（需要 filter）");
    }
    // filter.id 是 react 家族的正则：非 react 说明符一次都不会进 handler。
    const idFilter = resolveId.filter?.id;
    assert.ok(idFilter instanceof RegExp, "filter.id 必须是正则（resolveId 不接受字符串）");
    assert.equal(idFilter.test("react"), true);
    assert.equal(idFilter.test(REACT_DOM_SERVER), true);
    assert.equal(idFilter.test("zod"), false);
    const { handler } = resolveId;
    assert.deepEqual(handler.call({} as never, "react"), { id: "react", external: true });
    assert.throws(() => handler.call({} as never, REACT_DOM_SERVER), /react 家族/u);
  });

  it("只有 react 家族登记项时 external 数组为空", () => {
    assert.deepEqual(clientExternalPatterns([...REACT_RUNTIME_MODULES]), []);
  });
});

describe("buildClientArtifacts", () => {
  const CHUNK_FILE = "client.charts.js";
  const CHUNK_SOURCE = path.join("src", "charts.ts");
  // 入口源码里引用 chunk 的那一行：形态必须是宿主 ClientBundleRequire.async 认的
  // require.async("./client.<name>.js")，且占位符不能带变量（构建期只做字面匹配）。
  const ENTRY_ASKS_CHUNK = 'const chart = () => require.async("./client.charts.js");';

  it("入口在首位，chunk 按声明顺序；外壳 只给 chunk 加 chunk 位", async () => {
    const { factory, calls } = stubRolldown({
      outputs: [[chunkOf(ENTRY_ASKS_CHUNK)], [chunkOf(CHUNK_BODY)]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildClientArtifacts({
        root,
        rolldown: factory,
        header: HEADER,
        chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
      });
      assert.equal(artifacts.length, 2);
      const [entry, chunk] = artifacts;
      if (entry === undefined || chunk === undefined) {
        assert.fail("产物数量不足");
      }
      assert.equal(entry.fileName, "client.js");
      assert.equal(chunk.fileName, CHUNK_FILE);
      // 入口没有 chunk 位，chunk 有：宿主据此决定注册键是包名还是 chunkId。
      assert.ok(!entry.text.includes("  chunk:"));
      assert.ok(chunk.text.includes(`  chunk: ${JSON.stringify(CHUNK_FILE)},`));
      // 两份产物各自带 header（产物是独立文件，不能只有第一份带）。
      assert.ok(entry.text.startsWith(`${HEADER}\n`));
      assert.ok(chunk.text.startsWith(`${HEADER}\n`));
      // 每份源文件各起一趟构建。
      assert.equal(calls.length, 2);
      assert.equal(calls[0]?.options.input, path.join(root, CLIENT_ENTRY_REL));
      assert.equal(calls[1]?.options.input, path.join(root, CHUNK_SOURCE));
    } finally {
      await cleanup(root);
    }
  });

  it("没有 chunk 时与 buildClientBundle 逐字节一致", async () => {
    const plan = { outputs: [[chunkOf(ENTRY_BODY)]] } as const;
    const first = stubRolldown(plan);
    const second = stubRolldown(plan);
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildClientArtifacts({
        root,
        rolldown: first.factory,
        header: HEADER,
      });
      const text = await buildClientBundle({ root, rolldown: second.factory, header: HEADER });
      assert.equal(artifacts.length, 1);
      assert.equal(artifacts[0]?.text, text);
    } finally {
      await cleanup(root);
    }
  });

  it("chunk 产物名不含 client. 前缀：构建期失败", async () => {
    const { factory, calls } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientArtifacts({
          root,
          rolldown: factory,
          header: HEADER,
          chunks: [{ source: CHUNK_SOURCE, fileName: "charts.js" }],
        }),
        /不匹配宿主的包内 chunk 规则/u,
      );
      assert.equal(calls.length, 0);
    } finally {
      await cleanup(root);
    }
  });

  it("chunk 产物名含非法字符或多余扩展：构建期失败", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await Promise.all(
        ["client.ch arts.js", "client.charts.ts", "client..js", "client.jsx"].map((fileName) =>
          assert.rejects(
            buildClientArtifacts({
              root,
              rolldown: factory,
              header: HEADER,
              chunks: [{ source: CHUNK_SOURCE, fileName }],
            }),
            /不匹配宿主的包内 chunk 规则/u,
          ),
        ),
      );
    } finally {
      await cleanup(root);
    }
  });

  it("chunk 撞上 client.node.* 保留名：构建期失败", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await Promise.all(
        ["client.node.js", "client.node.charts.js"].map((fileName) =>
          assert.rejects(
            buildClientArtifacts({
              root,
              rolldown: factory,
              header: HEADER,
              chunks: [{ source: CHUNK_SOURCE, fileName }],
            }),
            /撞上 Node 客户端入口的保留名/u,
          ),
        ),
      );
    } finally {
      await cleanup(root);
    }
  });

  it("同一产物名声明两次：构建期失败", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientArtifacts({
          root,
          rolldown: factory,
          header: HEADER,
          chunks: [
            { source: CHUNK_SOURCE, fileName: CHUNK_FILE },
            { source: "src/other.ts", fileName: CHUNK_FILE },
          ],
        }),
        /chunk 产物名重复/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("声明了却没人 require.async：构建期失败（打进包里却永远不加载）", async () => {
    const { factory } = stubRolldown({
      outputs: [[chunkOf(ENTRY_BODY)], [chunkOf(CHUNK_BODY)]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientArtifacts({
          root,
          rolldown: factory,
          header: HEADER,
          chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
        }),
        /已声明但没有任何产物用 require\.async/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("入口里的同步相对 require 指向 chunk：构建期失败（宿主模块表没有这条边）", async () => {
    const { factory } = stubRolldown({
      outputs: [
        // 同时写了 require.async 与同步 require：判据必须是同步那条先响，
        // 否则「引用齐全」会把静态边遮住。
        [
          chunkOf(
            'const a = require.async("./client.charts.js");\nconst b = require("./client.charts.js");',
          ),
        ],
        [chunkOf(CHUNK_BODY)],
      ],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientArtifacts({
          root,
          rolldown: factory,
          header: HEADER,
          chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
        }),
        /包内相对同步 require/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("引用形态：反引号与括号内空白都算引用", async () => {
    const { factory } = stubRolldown({
      // 压缩产物用反引号写字符串，且可能带空白；两者都是合法引用。
      outputs: [
        [chunkOf("const a = require.async( `./client.charts.js` );")],
        [chunkOf(CHUNK_BODY)],
      ],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildClientArtifacts({
        root,
        rolldown: factory,
        header: HEADER,
        chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
      });
      assert.equal(artifacts.length, 2);
    } finally {
      await cleanup(root);
    }
  });

  it("chunk 侧引用另一个 chunk 也算已引用（入口不必自己引用每个 chunk）", async () => {
    const { factory } = stubRolldown({
      outputs: [
        [chunkOf(ENTRY_ASKS_CHUNK)],
        [chunkOf('require.async("./client.detail.js");')],
        [chunkOf("module.exports = 3;")],
      ],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const artifacts = await buildClientArtifacts({
        root,
        rolldown: factory,
        header: HEADER,
        chunks: [
          { source: CHUNK_SOURCE, fileName: CHUNK_FILE },
          { source: "src/detail.ts", fileName: "client.detail.js" },
        ],
      });
      assert.deepEqual(
        artifacts.map((artifact) => artifact.fileName),
        ["client.js", CHUNK_FILE, "client.detail.js"],
      );
    } finally {
      await cleanup(root);
    }
  });

  it("verifyName 对每份产物各调一次（包名同源校验不漏 chunk）", async () => {
    const { factory } = stubRolldown({
      outputs: [[chunkOf(ENTRY_ASKS_CHUNK)], [chunkOf(CHUNK_BODY)]],
    });
    const root = await fixtureRoot(BASE_MANIFEST);
    const seen: string[] = [];
    try {
      await buildClientArtifacts({
        root,
        rolldown: factory,
        header: HEADER,
        chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
        verifyName: (context) => {
          seen.push(`${context.pkgName}:${context.body.trim()}`);
        },
      });
      assert.deepEqual(seen, [
        `${FIXTURE_NAME}:${ENTRY_ASKS_CHUNK}`,
        `${FIXTURE_NAME}:module.exports = 2;`,
      ]);
    } finally {
      await cleanup(root);
    }
  });

  it("未登记的外置 require：构建期失败（否则加载期撞模块表）", async () => {
    const leaked = 'const x = require("lodash");';
    const { factory } = stubRolldown({ outputs: [[chunkOf(leaked)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /未登记的外置 require："lodash"/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("包名登记了但子路径没登记：同样失败（按包名边界外置的配套闸门）", async () => {
    // 这正是三个仓泄漏的形态：外置规则按包名命中，产物里留下一条宿主模块表里没有的
    // require。宿主按说明符全等查键，所以「包名在清单里」不等于「这一条能加载」。
    const leaked = `const x = require("${SHARED_TOOL}");`;
    const { factory } = stubRolldown({ outputs: [[chunkOf(leaked)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({
          root,
          rolldown: factory,
          header: HEADER,
          externals: [...REACT_RUNTIME_MODULES, SHARED_CLIENT],
        }),
        /dsh-plugin-shared\/tool/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("裸包名登记、子路径没登记：产物闸门判红（自查视图与构建同一口径）", async () => {
    // 外置规则对裸包名按边界泛化，`zod` 会把 `zod/v4` 也外置；宿主模块表没有 `zod/v4`，
    // 所以构建必须失败。这条同时是 clientExternalPredicate 对该输入抛错的实物对照。
    const leaked = 'const x = require("zod/v4");';
    const { factory } = stubRolldown({ outputs: [[chunkOf(leaked)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({
          root,
          rolldown: factory,
          header: HEADER,
          externals: [...REACT_RUNTIME_MODULES, "zod"],
        }),
        /未登记的外置 require："zod\/v4"/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("缺 parseAst：构建直接失败，不退化成少检查一项", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundleRaw({ root, rolldown: factory, header: HEADER }),
        /缺少 parseAst/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("产物解析失败：抛出带产物名的错误，不退化成少检查一项", async () => {
    const { factory } = stubRolldown({ outputs: [[chunkOf()]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundleRaw({
          root,
          rolldown: factory,
          header: HEADER,
          parseAst: () => {
            throw new Error("parse boom");
          },
        }),
        // 缺省入口经 path.join 构造，错误消息里的分隔符随平台：字符类同时放行 / 与 \。
        /解析 src[/\\]client-entry\.ts 的 client 产物失败（require 判据）：.*parse boom/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("正则字面量里的 require 片段不算外置调用（判据读 AST）", async () => {
    // 文本扫描会把 /require("lodash")/ 当成真实调用；AST 里它只是一个 RegExpLiteral。
    const body = String.raw`const re = /require("lodash")/; module.exports = re;`;
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const out = await buildClientBundle({ root, rolldown: factory, header: HEADER });
      assert.ok(out.includes(String.raw`/require("lodash")/`));
    } finally {
      await cleanup(root);
    }
  });

  it("非字面 require：构建期失败（说明符在运行期才算出来）", async () => {
    const body = 'const name = "lodash"; module.exports = require(name);';
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /非字面 require\(\.\.\.\)/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("非字面 require.async：构建期失败（指向的产物无法核对）", async () => {
    const body = "const name = `./client.charts.js`; module.exports = () => require.async(name);";
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /非字面 require\.async\(\.\.\.\)/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("引用未声明的 chunk：构建期失败（宿主不会提供没构建的文件）", async () => {
    const body = 'module.exports = () => require.async("./client.ghost.js");';
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /未声明的 chunk 引用/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("非相对 require.async：同样按未声明判红（裸名不是宿主动态加载的文件）", async () => {
    // 读取端只接受 `./` 开头的相对说明符；`require.async("client.charts.js")`
    // 即使目录里真有这个文件，也不在宿主提供的模块表里。
    const body = 'module.exports = () => require.async("client.charts.js");';
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /未声明的 chunk 引用/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("包内相对静态 require：构建期失败（宿主模块表没有相对路径这条边）", async () => {
    const body = 'module.exports = require("./helper.js");';
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientBundle({ root, rolldown: factory, header: HEADER }),
        /包内相对同步 require/u,
      );
    } finally {
      await cleanup(root);
    }
  });

  it("登记过的外置 require 放行", async () => {
    const body = [
      'const r = require("react");',
      'const z = require("zod");',
      "module.exports = { r, z };",
    ].join("\n");
    const { factory } = stubRolldown({ outputs: [[chunkOf(body)]] });
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      const out = await buildClientBundle({
        root,
        rolldown: factory,
        header: HEADER,
        externals: [...REACT_RUNTIME_MODULES, "zod"],
      });
      assert.ok(out.includes('require("react")'));
    } finally {
      await cleanup(root);
    }
  });

  it("chunk 构建失败时整批失败，且失败那次的 bundle 也已释放", async () => {
    const plan: StubPlan = {
      outputs: [[chunkOf(ENTRY_ASKS_CHUNK)], []],
    };
    const { factory, calls } = stubRolldown(plan);
    const root = await fixtureRoot(BASE_MANIFEST);
    try {
      await assert.rejects(
        buildClientArtifacts({
          root,
          rolldown: factory,
          header: HEADER,
          chunks: [{ source: CHUNK_SOURCE, fileName: CHUNK_FILE }],
        }),
        /期望恰好一个 entry chunk/u,
      );
      assert.equal(calls[1]?.closed, true);
    } finally {
      await cleanup(root);
    }
  });
});
