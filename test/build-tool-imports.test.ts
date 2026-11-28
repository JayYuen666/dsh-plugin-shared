// build-tool-imports 防回归：官方 transform 不认识的 TypeScript `importKind` 必须先被收窄，
// 且 `/tool` 的每条值导入都必须能在 tool-map 里找到目标模块。
//
// 这里不重复验官方插件的重写规则；那一段由消费仓的 build-host 用例按「产物里只剩
// internal/tool/<module>」验证。本用例守的是共享切面自己的边界：type-only 剥离、
// 入口形状拒绝、再导出拒绝（两种写法）、tool-map 缺项与不可路由名字点名失败，
// 以及 `/tool` 仍然是传给官方插件的唯一说明符。
import { describe, expect, it } from "vitest";
import { parseAst } from "rolldown/parseAst";
import {
  SHARED_INTERNAL_TOOL_PREFIX,
  SHARED_TOOL_SPECIFIER,
  toolImportGuard,
  toolImportTransform,
  type ToolImportMap,
  type ToolImportRoute,
} from "../lib/build-tool-imports.ts";

type TransformHook = (code: string, id: string) => { code: string } | null;

const SAMPLE_ID = "/tmp/sample.ts";

/** 从插件对象里取 transform 钩子：本切面的 guard 是函数形态，官方插件是对象形态。 */
function transformHookOf(plugin: unknown): TransformHook {
  const { transform } = plugin as {
    transform?: TransformHook | { handler?: TransformHook };
  };
  if (typeof transform === "function") {
    return transform;
  }
  if (transform !== undefined && typeof transform.handler === "function") {
    return transform.handler;
  }
  throw new Error("插件没有可调用的 transform 钩子");
}

/** 记录官方插件收到的路由配置，返回一个不参与构建的占位插件。 */
function recordingFactory(): {
  factory: (options: Record<string, ToolImportRoute>) => { name: string };
  calls: Record<string, ToolImportRoute>[];
} {
  const calls: Record<string, ToolImportRoute>[] = [];
  return {
    calls,
    factory: (options) => {
      calls.push(options);
      return { name: "test-transform-imports" };
    },
  };
}

/** 用固定映射构造 guard 的 transform 钩子。 */
function guardWithMap(toolMap: ToolImportMap): TransformHook {
  const { factory } = recordingFactory();
  const [guard] = toolImportTransform({ transformImports: factory, parseAst, toolMap });
  return transformHookOf(guard);
}

/** 本文件大多数用例共用的最小映射。 */
function defaultGuard(): TransformHook {
  return guardWithMap({ fillPlaceholders: "placeholder" });
}

describe("toolImportTransform()", () => {
  it("把 tool-map 按导出名排序后交给官方插件，目标落在 internal/tool/<module>", () => {
    const { factory, calls } = recordingFactory();
    const [guard, transform] = toolImportTransform({
      transformImports: factory,
      parseAst,
      toolMap: { zeta: "value", alpha: "record" },
    });
    expect(guard).toBeDefined();
    expect(transform).toMatchObject({ name: "test-transform-imports" });
    const route = calls[0]?.[SHARED_TOOL_SPECIFIER];
    expect(route).toBeDefined();
    expect(route?.skipDefaultConversion).toBe(true);
    expect(route?.preventFullImport).toBe(true);
    expect(route?.transform).toStrictEqual([
      ["alpha", `${SHARED_INTERNAL_TOOL_PREFIX}/record`],
      ["zeta", `${SHARED_INTERNAL_TOOL_PREFIX}/value`],
    ]);
  });

  it("缺省读包内 dist/tool-map.json，isRecord 落到 record", () => {
    const { factory, calls } = recordingFactory();
    const plugins = toolImportTransform({ transformImports: factory, parseAst });
    expect(plugins).toHaveLength(2);
    const route = calls[0]?.[SHARED_TOOL_SPECIFIER];
    expect(route?.transform).toContainEqual(["isRecord", `${SHARED_INTERNAL_TOOL_PREFIX}/record`]);
    expect(route?.transform.length).toBeGreaterThan(40);
  });

  it("注入映射在创建时快照，调用方事后改表不影响路由", () => {
    const { factory, calls } = recordingFactory();
    const toolMap: Record<string, string> = { fillPlaceholders: "placeholder" };
    void toolImportTransform({ transformImports: factory, parseAst, toolMap });
    toolMap["fillPlaceholders"] = "record";
    expect(calls[0]?.[SHARED_TOOL_SPECIFIER]?.transform).toStrictEqual([
      ["fillPlaceholders", `${SHARED_INTERNAL_TOOL_PREFIX}/placeholder`],
    ]);
  });

  it("json 里的 __proto__ 是自有条目：路由与守卫都按普通名字处理", () => {
    const { factory, calls } = recordingFactory();
    const toolMap = JSON.parse('{"__proto__":"record","fillPlaceholders":"placeholder"}') as Record<
      string,
      string
    >;
    const [guard] = toolImportTransform({ transformImports: factory, parseAst, toolMap });
    expect(calls[0]?.[SHARED_TOOL_SPECIFIER]?.transform).toContainEqual([
      "__proto__",
      `${SHARED_INTERNAL_TOOL_PREFIX}/record`,
    ]);
    expect(
      transformHookOf(guard)(
        `import { __proto__ as p } from "${SHARED_TOOL_SPECIFIER}";`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { __proto__ as p } from "${SHARED_TOOL_SPECIFIER}";`);
  });

  it("直接传 Map 也走同一套校验并复制", () => {
    const { factory, calls } = recordingFactory();
    const toolMap = new Map([["fillPlaceholders", "placeholder"]]);
    void toolImportTransform({ transformImports: factory, parseAst, toolMap });
    toolMap.set("fillPlaceholders", "record");
    expect(calls[0]?.[SHARED_TOOL_SPECIFIER]?.transform).toStrictEqual([
      ["fillPlaceholders", `${SHARED_INTERNAL_TOOL_PREFIX}/placeholder`],
    ]);
    expect(() => toolImportGuard({ parseAst, toolMap: new Map([["a-b", "record"]]) })).toThrow(
      /无法路由/u,
    );
    expect(() => toolImportGuard({ parseAst, toolMap: new Map() })).toThrow(/空表/u);
  });

  it.each([
    ["非标识符导出名", { "a-b": "record" }, /无法路由/u],
    ["正则元字符导出名", { foo$: "record" }, /无法路由/u],
  ])("注入映射出现%s时拒绝", (_label, toolMap, pattern) => {
    const { factory } = recordingFactory();
    expect(() =>
      toolImportTransform({
        transformImports: factory,
        parseAst,
        toolMap,
      }),
    ).toThrow(pattern);
  });

  it("直接构造 guard 时接受记录形态并做同一套校验", () => {
    const guard = toolImportGuard({ parseAst, toolMap: { fillPlaceholders: "placeholder" } });
    expect(
      transformHookOf(guard)(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`);
    expect(() => toolImportGuard({ parseAst, toolMap: { "a-b": "record" } })).toThrow(/无法路由/u);
  });
});

describe("toolImportGuard() 的导入收窄", () => {
  /** 用固定映射构造 guard 的 transform 钩子。 */
  it("剥掉 type-only 说明符，只把值说明符留给官方插件", () => {
    const result = defaultGuard()(
      `import { type MessagesCatalog, fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nconsole.log(fillPlaceholders);`,
      SAMPLE_ID,
    );
    expect(result?.code).toBe(
      `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nconsole.log(fillPlaceholders);`,
    );
  });

  it("整条删除纯 type import 时留下空语句，保住前后语句边界", () => {
    const result = defaultGuard()(
      `import type { MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";\nconsole.log(1);`,
      SAMPLE_ID,
    );
    expect(result?.code).toBe(";\nconsole.log(1);");
  });

  it("删除声明不会让相邻语句因 ASI 拼接", () => {
    const result = defaultGuard()(
      `run()\nimport type { MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}"\n[1].forEach(log)\n`,
      SAMPLE_ID,
    );
    expect(result?.code).toBe("run()\n;\n[1].forEach(log)\n");
  });

  it("一次替换多条 /tool 导入，倒序执行不移动前面的偏移", () => {
    const result = guardWithMap({ fillPlaceholders: "placeholder", isRecord: "record" })(
      `import { type MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";\nimport { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nimport { isRecord } from "${SHARED_TOOL_SPECIFIER}";`,
      SAMPLE_ID,
    );
    expect(result?.code).toBe(
      `;\nimport { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nimport { isRecord } from "${SHARED_TOOL_SPECIFIER}";`,
    );
  });

  it("非 TS、无 /tool 导入与无实际替换的源码直接放行", () => {
    const transform = defaultGuard();
    expect(transform(`const value = 1;`, "/tmp/sample.js")).toBeNull();
    expect(transform(`const value = 1;`, SAMPLE_ID)).toBeNull();
    expect(transform(`const marker = "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)).toBeNull();
    expect(transform(`import value from "elsewhere";`, SAMPLE_ID)).toBeNull();
    // query 串先剥掉再判扩展名：`.js?file=other.ts` 不是 TS 源，`.ts?raw` 是。
    expect(transform(`const value = 1;`, "/tmp/entry.js?file=other.ts")).toBeNull();
    expect(
      transform(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`, "/tmp/a.ts?raw")
        ?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`);
  });

  it("只含类型说明符时返回空语句，并保留别名与字面量导入名", () => {
    const transform = defaultGuard();
    expect(
      transform(`import { type MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)
        ?.code,
    ).toBe(";");
    expect(
      transform(`import { fillPlaceholders as fill } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)
        ?.code,
    ).toBe(`import { fillPlaceholders as fill } from "${SHARED_TOOL_SPECIFIER}";`);
    expect(
      transform(`import { "fillPlaceholders" as fill } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)
        ?.code,
    ).toBe(`import { fillPlaceholders as fill } from "${SHARED_TOOL_SPECIFIER}";`);
  });

  it("转义说明符按 AST 的值处理，重建后写回字面说明符", () => {
    const escaped = `"@jayyuen66/dsh-plugin-shared/t\\u006fol"`;
    const transform = defaultGuard();
    expect(transform(`import { fillPlaceholders } from ${escaped};`, SAMPLE_ID)?.code).toBe(
      `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`,
    );
    expect(transform(`import type { MessagesCatalog } from ${escaped};`, SAMPLE_ID)?.code).toBe(
      ";",
    );
    expect(() => transform(`import * as ns from ${escaped};`, SAMPLE_ID)).toThrow(/非具名导入/u);
  });

  it("tsx 按 tsx 语法解析并保留 JSX", () => {
    const result = defaultGuard()(
      `const view = <div a={1} />;\nimport { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\n`,
      "/tmp/sample.tsx",
    );
    expect(result?.code).toBe(
      `const view = <div a={1} />;\nimport { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\n`,
    );
  });

  it("mts/cts 取值时点名官方插件的过滤面，类型导入仍可剥离", () => {
    const transform = defaultGuard();
    expect(() =>
      transform(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`, "/tmp/a.mts"),
    ).toThrow(/只认 \[jt\]sx/u);
    expect(
      transform(`import type { MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";`, "/tmp/a.cts")
        ?.code,
    ).toBe(";");
  });
});

describe("toolImportGuard() 的入口形状与再导出拒绝", () => {
  it("未知导出、default、namespace 与 side-effect 都点名失败", () => {
    const transform = defaultGuard();
    expect(() =>
      transform(`import { missing } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID),
    ).toThrow(/dist\/tool-map\.json 没有它/u);
    expect(() => transform(`import shared from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)).toThrow(
      /非具名导入/u,
    );
    expect(() =>
      transform(`import * as shared from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID),
    ).toThrow(/非具名导入/u);
    expect(() => transform(`import "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)).toThrow(
      /side-effect import/u,
    );
    expect(() =>
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}" with { type: "json" };`,
        SAMPLE_ID,
      ),
    ).toThrow(/import attributes/u);
  });

  it("原型链上的名字不算 tool-map 条目", () => {
    expect(() =>
      defaultGuard()(`import { toString as helper } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID),
    ).toThrow(/dist\/tool-map\.json 没有它/u);
  });

  it("非标识符的字面量导入名点名失败", () => {
    expect(() =>
      defaultGuard()(`import { "a-b" as value } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID),
    ).toThrow(/字面量名 "a-b"/u);
  });

  it("export … from /tool 的值再导出拒绝，类型再导出整条删除", () => {
    const transform = defaultGuard();
    expect(() =>
      transform(`export { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID),
    ).toThrow(/再导出/u);
    expect(() => transform(`export * from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)).toThrow(
      /再导出/u,
    );
    expect(() =>
      transform(
        `export { type MessagesCatalog, fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";`,
        SAMPLE_ID,
      ),
    ).toThrow(/再导出/u);
    expect(
      transform(`export type { MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)
        ?.code,
    ).toBe(";");
    expect(
      transform(`export { type MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)
        ?.code,
    ).toBe(";");
    expect(transform(`export {} from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)?.code).toBe(";");
    expect(transform(`export type * from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)?.code).toBe(";");
    expect(transform(`export type * as ns from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)?.code).toBe(
      ";",
    );
    expect(() => transform(`export * as ns from "${SHARED_TOOL_SPECIFIER}";`, SAMPLE_ID)).toThrow(
      /再导出/u,
    );
  });

  it("先导入再导出同样拒绝，类型面转发放行", () => {
    const transform = defaultGuard();
    expect(() =>
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport { fillPlaceholders };`,
        SAMPLE_ID,
      ),
    ).toThrow(/把 shared\/tool 的值 fillPlaceholders 再导出/u);
    expect(() =>
      transform(
        `import { fillPlaceholders as fill } from "${SHARED_TOOL_SPECIFIER}";\nexport { fill };`,
        SAMPLE_ID,
      ),
    ).toThrow(/把 shared\/tool 的值 fill 再导出/u);
    expect(() =>
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default fillPlaceholders;`,
        SAMPLE_ID,
      ),
    ).toThrow(/把 shared\/tool 的值 fillPlaceholders 再导出/u);
    expect(
      transform(
        `import type { MessagesCatalog } from "${SHARED_TOOL_SPECIFIER}";\nexport type { MessagesCatalog };`,
        SAMPLE_ID,
      )?.code,
    ).toBe(";\nexport type { MessagesCatalog };");
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport const value = 1;`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport const value = 1;`);
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport { other };`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport { other };`);
    // 默认导出不指向 shared 的值时放行：字面量、未转发的标识符两条都要有。
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default 1;`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default 1;`);
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default other;`,
        SAMPLE_ID,
      )?.code,
    ).toBe(`import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default other;`);
    // TS 只影响类型的包装擦除后仍是同一个值，默认导出的转发判定必须穿透它们。
    for (const wrapped of [
      "(fillPlaceholders)",
      "fillPlaceholders as unknown",
      "fillPlaceholders!",
      "fillPlaceholders satisfies unknown",
      "<unknown>fillPlaceholders",
    ]) {
      expect(() =>
        transform(
          `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default ${wrapped};`,
          SAMPLE_ID,
        ),
      ).toThrow(/把 shared\/tool 的值 fillPlaceholders 再导出/u);
    }
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default other as unknown;`,
        SAMPLE_ID,
      )?.code,
    ).toBe(
      `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport default other as unknown;`,
    );
    // 整条 export type 与说明符级 type 都是类型面，不产生运行期转发。
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport type { fillPlaceholders };`,
        SAMPLE_ID,
      )?.code,
    ).toBe(
      `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport type { fillPlaceholders };`,
    );
    expect(
      transform(
        `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport { type fillPlaceholders };`,
        SAMPLE_ID,
      )?.code,
    ).toBe(
      `import { fillPlaceholders } from "${SHARED_TOOL_SPECIFIER}";\nexport { type fillPlaceholders };`,
    );
  });
});
