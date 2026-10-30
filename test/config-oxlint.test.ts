import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_RULES,
  E18E_RULES,
  OFF_JUSTIFICATIONS,
  PROD_OVERRIDES,
  REGEXP_RULES,
  RETIRED_OFFS,
  SCRIPTS_OVERRIDES,
  TEST_FILE_OVERRIDES,
  TEST_OVERRIDES,
  VITEST_ALL_RULES,
  VITEST_ASSERTION_DEFAULTS,
  ZOD_RULES,
  definePluginConfig,
  makeTestFileOverrides,
  resolveBundledJsPlugins,
  resolveJsPlugins,
} from "../config/oxlint.base.ts";
import type { OffReason, RuleTable } from "../config/oxlint.base.ts";
import type { ExternalPluginEntry } from "oxlint";

/** 取一条规则设置里的severity（oxlint 的设置可以是 `"off"` 或 `["off", {…}]`）。 */
function severity(setting: unknown): string {
  return String(Array.isArray(setting) ? setting[0] : setting);
}

/** 把每条 off 的键摊平出来，便于整表核对。 */
function offKeys(rules: RuleTable | undefined): string[] {
  return Object.entries(rules ?? {})
    .filter(([, setting]) => severity(setting) === "off")
    .map(([rule]) => rule);
}

/**
 * 取一条规则设置里的 ignores（设置写成 `["error", { ignores: [...] }]` 时）。
 *
 * @param setting - 规则设置，形态由 oxlint 的类型给
 * @returns 那份名单；不是这个形态时 undefined
 */
function ignoresOf(setting: unknown): string[] | undefined {
  const options: unknown = Array.isArray(setting) ? setting[1] : undefined;
  return (options as { ignores?: string[] } | undefined)?.ignores;
}

/** syncIoScopes 用例里的两个被测字面量：写侧 API 名与被点名的文件。 */
const LOCK_FILE = "lib/lock.ts";
const WRITE_API = "writeFileSync";

const KINDS: OffReason[] = [
  "与官方形态冲突",
  "与已启用规则互斥",
  "实测有害",
  "仅限特定文件",
  "上游不推荐",
  "零命中作废",
];

/** 注入 stub 用的三条入口路径与「解析不到」的文案：提为模块级常量（用例里重复出现同一字面量会被
 *  no-duplicate-string 记一次），解析器替身也提到模块级（consistent-function-scoping）。 */
const BUNDLED_ENTRY = "/bundled.js";
/** 调用方自备的 sonarjs 入口：这条退路只认路径里指向 sonarjs 的那一个。 */
const OWN_SONARJS_ENTRY = "/own/eslint-plugin-sonarjs.js";
/** 与 sonarjs 无关的调用方入口：它无法弥补 SONARJS_RULES 的缺包。 */
const OWN_LOCAL_ENTRY = "/own/local-rules.js";
/** 调用方自备的 regexp 入口：挂载后不得再把本包解析到的那一份挂第二遍。 */
const OWN_REGEXP_ENTRY = "/own/eslint-plugin-regexp.js";
const SONARJS_MISSING = "解析不到 sonarjs";
const SONARJS_MISSING_PATTERN = /解析不到 sonarjs/u;
const REGEXP_MISSING_PATTERN = /eslint-plugin-regexp/u;

/** 「本仓解析不到 regexp」的 stub 解析器。生产路径永远成功，缺包支只能靠 stub 走到。 */
function boomRegexp(): string {
  throw new Error("解析不到 eslint-plugin-regexp");
}

/** 「本仓解析不到 sonarjs」的 stub 解析器。生产路径永远成功，那两个分支只能靠 stub 走到。 */
function boomSonarjs(): string {
  throw new Error(SONARJS_MISSING);
}

/** 读一条 JS plugin 的模块面：有的包把 plugin 挂在 default 上，两形都认。 */
interface PluginModule {
  rules?: Record<string, unknown>;
  configs?: Record<string, { rules?: Record<string, unknown> }>;
}

/** 入口文本：字符串形态直接用，对象形态拼 name + specifier（与基线 same 判据）。 */
function entryText(entry: ExternalPluginEntry): string {
  return typeof entry === "string" ? entry : `${entry.name} ${entry.specifier}`;
}

/** 包名各写一次常量：require 那一侧必须是字面量（import/no-dynamic-require），
 *  但键与 loadPlugin 的调用走常量，避免同一字面量在用例里出现三次触发 no-duplicate-string。 */
const REGEXP_PLUGIN_ID = "eslint-plugin-regexp";
const ZOD_PLUGIN_ID = "eslint-plugin-zod";
const E18E_PLUGIN_ID = "@e18e/eslint-plugin";

const PLUGIN_MODULES: Record<string, PluginModule & { default?: PluginModule }> = {
  [REGEXP_PLUGIN_ID]: createRequire(import.meta.url)("eslint-plugin-regexp") as PluginModule & {
    default?: PluginModule;
  },
  [ZOD_PLUGIN_ID]: createRequire(import.meta.url)("eslint-plugin-zod") as PluginModule & {
    default?: PluginModule;
  },
  [E18E_PLUGIN_ID]: createRequire(import.meta.url)("@e18e/eslint-plugin") as PluginModule & {
    default?: PluginModule;
  },
};

function loadPlugin(id: keyof typeof PLUGIN_MODULES): PluginModule {
  const loaded = PLUGIN_MODULES[id];
  if (loaded === undefined) {
    throw new Error(`测试要读的插件模块没有登记：${id}`);
  }
  return loaded.default ?? loaded;
}

describe("definePluginConfig：关规则必须留依据", () => {
  it("jsPlugins：默认解析到本包的四个常挂插件入口", () => {
    const cfg = definePluginConfig();
    expect(cfg.jsPlugins ?? []).toHaveLength(4);
  });

  it("jsPlugins：调用方自带 regexp 入口时不再解析本包那一份，同一条插件只挂一次", () => {
    const cfg = definePluginConfig({ jsPlugins: [OWN_REGEXP_ENTRY] });
    expect(cfg.jsPlugins ?? []).toHaveLength(4);
    expect(
      (cfg.jsPlugins ?? []).filter((entry) => entryText(entry).includes("regexp")),
    ).toHaveLength(1);
  });

  it("jsPlugins：regexp 缺包且调用方没自带入口 ⇒ 装载即抛，消息点名要装的包", () => {
    expect(() => resolveBundledJsPlugins(undefined, { regexp: boomRegexp })).toThrow(
      REGEXP_MISSING_PATTERN,
    );
    expect(
      resolveBundledJsPlugins([OWN_REGEXP_ENTRY], { regexp: boomRegexp }).some((entry) =>
        entryText(entry).includes(REGEXP_PLUGIN_ID),
      ),
    ).toBe(true);
  });

  it("jsPlugins：解析成功时自带入口接在后面，重复的那个不追加第二遍", () => {
    // 本仓装得上 sonarjs，所以「解析成功」这一支是真实路径；去重靠传同一个入口验：
    // 原写法无脑拼接，调用方传的正是本包解析到的那个入口时会挂两遍。
    expect(resolveJsPlugins([OWN_LOCAL_ENTRY], () => BUNDLED_ENTRY)).toStrictEqual([
      BUNDLED_ENTRY,
      OWN_LOCAL_ENTRY,
    ]);
    expect(resolveJsPlugins([BUNDLED_ENTRY], () => BUNDLED_ENTRY)).toStrictEqual([BUNDLED_ENTRY]);
  });

  it("jsPlugins：解析失败时，指向 sonarjs 的自带入口即预留的退路", () => {
    // 两个方向缺一不可：原写法无条件先解析，报错信息给的补救办法（经 jsPlugins 传自己的
    // 入口）照做必然再报同一条——那正是「退路兑现不了」的形态。
    expect(resolveJsPlugins([OWN_SONARJS_ENTRY], boomSonarjs)).toStrictEqual([OWN_SONARJS_ENTRY]);
    expect(() => resolveJsPlugins(undefined, boomSonarjs)).toThrow(SONARJS_MISSING_PATTERN);
    expect(() => resolveJsPlugins([], boomSonarjs)).toThrow(SONARJS_MISSING_PATTERN);
  });

  it("jsPlugins：只带别家插件时解析失败必须照抛（吞掉会把可操作的成因换成 oxlint 的报错）", () => {
    // SONARJS_RULES 无条件引用 sonarjs：只带自家插件时配置照样以 `Plugin 'sonarjs' not found`
    // 失败，而那条报错不带补救办法。可操作的那条话必须在这里先出来。
    expect(() => resolveJsPlugins([OWN_LOCAL_ENTRY], boomSonarjs)).toThrow(SONARJS_MISSING_PATTERN);
  });

  it("出厂基线本身装载得动（每条 off 都在 OFF_JUSTIFICATIONS 里查到）", () => {
    expect(() => definePluginConfig()).not.toThrow();
  });

  it("包内把一条没登记的规则关成 off ⇒ 装载即抛，且错误信息指出该规则", () => {
    expect(() =>
      definePluginConfig({ extraRules: { "unicorn/no-array-for-each": "off" } }),
    ).toThrow(/unicorn\/no-array-for-each/u);
  });

  it("同一条规则带上 offReasons 后装载得动（例外要走书面依据，不是走静默）", () => {
    expect(() =>
      definePluginConfig({
        extraRules: { "unicorn/no-array-for-each": "off" },
        offReasons: {
          "unicorn/no-array-for-each": {
            kind: "仅限特定文件",
            measured: 12,
            note: "只在测试数据生成器里有意义",
          },
        },
      }),
    ).not.toThrow();
  });

  it("kind 写对但 note 是空的 ⇒ 仍然抛（依据不许是占位）", () => {
    expect(() =>
      definePluginConfig({
        extraRules: { "node/no-hereby": "off" },
        offReasons: { "node/no-hereby": { kind: "上游不推荐", measured: 0, note: "   " } },
      }),
    ).toThrow(/node\/no-hereby/u);
  });

  it("override 层里的 off 同样要登记：把规则在用例文件里关掉也得写依据", () => {
    expect(() =>
      definePluginConfig({
        extraOverrides: [{ files: ["**/*.test.ts"], rules: { "eslint/no-console": "off" } }],
      }),
    ).toThrow(/overrides\[4\]/u);
  });

  it('数组形态的关闭（["off"]）也走同一道检查，不被当成没关', () => {
    expect(() =>
      definePluginConfig({ extraRules: { "unicorn/no-array-for-each": ["off"] } }),
    ).toThrow(/unicorn\/no-array-for-each/u);
  });

  it("插件级通配键兜住整族：vitest 的 73 条不需要逐条登记", () => {
    const cfg = definePluginConfig();
    const vitestOff = offKeys(cfg.rules).filter((rule) => rule.startsWith("vitest/"));
    expect(vitestOff.length).toBeGreaterThan(60);
    expect(() =>
      definePluginConfig({ extraRules: { "vitest/some-future-rule": "off" } }),
    ).not.toThrow();
  });
});

describe("syncIoScopes：写侧豁免按文件生效", () => {
  it("一枚 scope 生成一条 override：只点名文件里额外允许那一枚，基线只读名单一起带上", () => {
    const cfg = definePluginConfig({
      syncIoScopes: [{ files: [LOCK_FILE], apis: [WRITE_API] }],
    });
    const scope = cfg.overrides?.[4];
    expect(scope?.files).toStrictEqual([LOCK_FILE]);
    const setting = scope?.rules?.["node/no-sync"];
    expect(Array.isArray(setting) ? setting[0] : setting).toBe("error");
    const ignores = ignoresOf(setting);
    expect(ignores).toContain(WRITE_API);
    // 基线只读名单必须一起带上：override 对同一条规则是整条设置替换（oxlint 1.90 实测——
    // override 只写 ignores:["readFileSync"] 时，基线豁免过的 existsSync 在那个文件里变成报的）。
    // 少了这一步，被点名的文件会凭空多出一批红。
    expect(ignores).toContain("existsSync");
    expect(ignores).toContain("readFileSync");
    expect(ignores).toContain("readdirSync");
    // 规则表本身不受影响：豁免只活在 override 层。
    expect(ignoresOf(cfg.rules?.["node/no-sync"])).not.toContain(WRITE_API);
  });

  it("scope 排在包内 extraOverrides 之前：包自己写的覆盖仍然压得住它", () => {
    const cfg = definePluginConfig({
      syncIoScopes: [{ files: ["lib/state-writer.ts"], apis: ["rmSync"] }],
      extraOverrides: [
        {
          files: ["lib/state-writer.ts"],
          rules: { "eslint/no-console": "off" },
        },
      ],
      offReasons: {
        "eslint/no-console": {
          kind: "仅限特定文件",
          measured: 1,
          note: "这条用例只关心 override 的先后顺序",
        },
      },
    });
    expect(ignoresOf(cfg.overrides?.[4]?.rules?.["node/no-sync"])).toContain("rmSync");
    expect(offKeys(cfg.overrides?.[5]?.rules)).toStrictEqual(["eslint/no-console"]);
  });

  it("files 或 apis 为空的 scope 当场抛，不留一条永不命中或不起作用的 override", () => {
    expect(() => definePluginConfig({ syncIoScopes: [{ files: [], apis: [WRITE_API] }] })).toThrow(
      /syncIoScopes\[0\]/u,
    );
    expect(() => definePluginConfig({ syncIoScopes: [{ files: [LOCK_FILE], apis: [] }] })).toThrow(
      /syncIoScopes\[0\]/u,
    );
  });

  it("同一条基线只读名在被点名的那份名单里只出现一次", () => {
    const cfg = definePluginConfig({
      syncIoScopes: [{ files: ["lib/fs-io.ts"], apis: ["readFileSync", WRITE_API] }],
    });
    const ignores = ignoresOf(cfg.overrides?.[4]?.rules?.["node/no-sync"]) ?? [];
    expect(ignores.filter((name) => name === "readFileSync")).toStrictEqual(["readFileSync"]);
  });
});

describe("关规则依据表要自洽（OFF_JUSTIFICATIONS）", () => {
  it("基线里每一条 off 都查得到依据，且 kind 只允许六类", () => {
    const undocumented = offKeys(BASE_RULES).filter(
      (rule) =>
        OFF_JUSTIFICATIONS[rule] === undefined &&
        OFF_JUSTIFICATIONS[`${rule.slice(0, rule.indexOf("/"))}/*`] === undefined,
    );
    expect(undocumented).toStrictEqual([]);
    for (const [, justification] of Object.entries(OFF_JUSTIFICATIONS)) {
      expect(KINDS).toContain(justification.kind);
      expect(justification.note.trim().length).toBeGreaterThan(0);
      expect(justification.measured).toBeGreaterThanOrEqual(0);
    }
  });

  it("依据表里不许留已经不再关着的规则（表就是关规则的登记，不是愿望清单）", () => {
    const stillOff = new Set([
      ...offKeys(BASE_RULES),
      ...offKeys(TEST_OVERRIDES.rules),
      ...offKeys(TEST_FILE_OVERRIDES.rules),
      ...offKeys(SCRIPTS_OVERRIDES.rules),
    ]);
    // 表上登记了依据、但没有任何地方真的关着它 = 愿望清单，不是登记表
    const stale = Object.keys(OFF_JUSTIFICATIONS).filter(
      (rule) => !rule.endsWith("/*") && !stillOff.has(rule),
    );
    expect(stale).toStrictEqual([]);
  });

  it("标题开头术语走 prefer-lowercase-title 自带的 allowedPrefixes，不改测试名也不关规则", () => {
    // 只登记真正的技术名：实测 oxlint 1.86 是"前缀一命中就整条标题免检"（登记 CSRF 之后，
    // 一条首字母大写的坏标题照样放过），所以表每长一条就多一片免检范围。规格 ticket 号已按 owner
    // 的决定从标题里删掉，中文开头的标题天然满足要求（无大小写），都不需要登记。
    // （细节：命中前缀之后下一个字符必须是术语边界，短一级的登记项如 Retry 会被检查指出。）
    const override = makeTestFileOverrides({ titlePrefixes: ["UsageWatch", "CSRF"] });
    const setting = override.rules?.["vitest/prefer-lowercase-title"];
    expect(Array.isArray(setting) ? setting[1] : undefined).toStrictEqual({
      allowedPrefixes: ["UsageWatch", "CSRF"],
    });
    // 没报名字时这条设置退回基线的裸 "error"（默认设置不放宽）
    expect(severity(makeTestFileOverrides().rules?.["vitest/prefer-lowercase-title"])).toBe(
      "error",
    );
  });

  it("expect-expect 的断言函数名跟 vitest flavor 的官方默认一致（含 node:assert 那一族）", () => {
    const setting = TEST_FILE_OVERRIDES.rules?.["vitest/expect-expect"];
    expect(Array.isArray(setting) ? setting[1] : undefined).toStrictEqual({
      assertFunctionNames: VITEST_ASSERTION_DEFAULTS,
    });
    expect(VITEST_ASSERTION_DEFAULTS).toStrictEqual([
      "expect",
      "expectTypeOf",
      "assert",
      "assertType",
    ]);
  });

  it("包内 helper 里断言的用例走规则自己的名单，而不是关规则或补假断言", () => {
    const override = makeTestFileOverrides({ assertionHelpers: ["assertSameLedger"] });
    const setting = override.rules?.["vitest/expect-expect"];
    expect(Array.isArray(setting) ? setting[1] : undefined).toStrictEqual({
      assertFunctionNames: [...VITEST_ASSERTION_DEFAULTS, "assertSameLedger"],
    });
    // 只替换 expect-expect 这一条：其余用例结构类判断原样带过来
    expect(severity(override.rules?.["vitest/valid-title"])).toBe("error");
    expect(override.files).toStrictEqual(TEST_FILE_OVERRIDES.files);
    // definePluginConfig 把它接进 overrides[1]
    const cfg = definePluginConfig({ assertionHelpers: ["assertSameLedger"] });
    const second = cfg.overrides?.[1]?.rules?.["vitest/expect-expect"];
    expect(JSON.stringify(second)).toContain("assertSameLedger");
  });

  it("反向：名单里塞通配或成员形式直接抛（那等于把 expect-expect 掏空）", () => {
    expect(() => makeTestFileOverrides({ assertionHelpers: ["assert.*"] })).toThrow(
      /只收裸标识符/u,
    );
    expect(() => makeTestFileOverrides({ titlePrefixes: ["UsageWatch.x"] })).toThrow(
      /只收裸标识符/u,
    );
    expect(() => definePluginConfig({ assertionHelpers: ["*"] })).toThrow(/只收裸标识符/u);
  });

  it("已取消的豁免（RETIRED_OFFS）不许在任何一层重新关起来", () => {
    const stillOff = new Set([
      ...offKeys(BASE_RULES),
      ...offKeys(TEST_OVERRIDES.rules),
      ...offKeys(TEST_FILE_OVERRIDES.rules),
      ...offKeys(SCRIPTS_OVERRIDES.rules),
    ]);
    expect(RETIRED_OFFS.filter((rule) => stillOff.has(rule))).toStrictEqual([]);
    expect(RETIRED_OFFS.length).toBeGreaterThan(0);
  });

  it("用例结构类判据走「基线关 + 用例文件开」，不是整条关掉", () => {
    expect(severity(BASE_RULES["vitest/require-hook"])).toBe("off");
    expect(severity(TEST_FILE_OVERRIDES.rules?.["vitest/require-hook"])).toBe("error");
    expect(severity(BASE_RULES["vitest/valid-title"])).toBe("off");
    expect(severity(TEST_FILE_OVERRIDES.rules?.["vitest/valid-title"])).toBe("error");
  });

  it("反向：与本仓约定相反的那几条（禁 hook、断言计数仪式）即使在用例文件里也不开回来", () => {
    for (const rule of [
      "vitest/no-hooks",
      "vitest/no-conditional-in-test",
      "vitest/max-expects",
      "vitest/prefer-expect-assertions",
      "vitest/require-test-timeout",
      "vitest/prefer-to-be-truthy",
      "vitest/prefer-to-be-falsy",
    ]) {
      // 基线关着，且 TEST_FILE_OVERRIDES 里没有把它开回来（缺键 = 继承基线的 off）
      expect(severity(BASE_RULES[rule])).toBe("off");
      expect(TEST_FILE_OVERRIDES.rules?.[rule]).toBeUndefined();
    }
  });

  it("包级例外不串味：上一条用例登记的例外不许替下一条的无依据 off 背书", () => {
    expect(() => definePluginConfig({ extraRules: { "node/no-unpublished-bin": "off" } })).toThrow(
      /node\/no-unpublished-bin/u,
    );
  });
});

describe("vitest 规则全集快照与 oxlint --rules 实际输出一致（不许自己过期）", () => {
  it("vitest 插件的规则全集逐条对上：上游新增/删除规则即失败，人工同步名单", () => {
    // categories 是全局 error 开关：上游在任一 category 新增 vitest 规则，它会先作用到
    // 生产文件。基线那张 off 名单是快照，靠这条用例跟住上游——失败时对名单，需要豁免的再补依据。
    // 同步子进程：本检查无并发需求，而 async 三种写法被基线的 promise 规则限制
    // （execFileSync 的登记见本包 oxlint.config.ts，danger-guard 的产物加载检查同款取舍）。
    const require = createRequire(import.meta.url);
    const oxlintBin = path.join(
      path.dirname(require.resolve("oxlint/package.json")),
      "bin",
      "oxlint",
    );
    // GitHub Actions 给每一步注入 GITHUB_ACTIONS=true；oxlint 在该标志下把 --rules 的
    // 列表整体静默（stdout 零字节、退出码 0），于是这条检查在 CI 上量到空集——本地没有
    // 这个变量，永远复现不了。解析用的子进程移除它：这里量的是规则集，不是「身处 CI」。
    // 同时关闭颜色（跑测类检查的既定纪律：子进程先关色，输出里的字面量才可匹配）。
    const childEnv = { ...process.env };
    delete childEnv["GITHUB_ACTIONS"];
    const stdout = execFileSync(process.execPath, [oxlintBin, "--rules"], {
      encoding: "utf8",
      env: { ...childEnv, NO_COLOR: "1", FORCE_COLOR: "0", CLICOLOR: "0" },
    });
    // 表行形状：`| <rule> | vitest | …`（规则名与插件名两列，右列宽度不定）。
    const names = Array.from(
      stdout.matchAll(/^\| (?<rule>[^|\s]+)\s+\| vitest\s+\|/gmu),
      (match) => match.groups?.["rule"] ?? "",
    );
    // 空集不算通过：解析不到任何行说明输出格式变了，检查什么都没量到。
    expect(
      names.length,
      "oxlint --rules 里没解析到任何 vitest 规则行（输出格式变了）",
    ).toBeGreaterThan(0);
    expect(new Set(names.map((name) => `vitest/${name}`))).toStrictEqual(new Set(VITEST_ALL_RULES));
  });
});

describe("js plugin 规则表与插件实际规则集一致（上游改名/删除即失败）", () => {
  // `oxlint --rules` 不列 JS plugin 的规则（实测只列内建插件），所以这几张表不从 oxlint 输出取，
  // 直接从插件模块的 rules/configs 读。表本身逐条写死，上游改名或删除就会在这里红。
  const regexp = loadPlugin(REGEXP_PLUGIN_ID);
  const zod = loadPlugin(ZOD_PLUGIN_ID);
  const e18e = loadPlugin(E18E_PLUGIN_ID);

  it("regexp：REGEXP_RULES 逐条对上 recommended 里的 regexp/* 规则", () => {
    const recommended = Object.entries(regexp.configs?.["recommended"]?.rules ?? {})
      .filter(([rule, setting]) => rule.startsWith("regexp/") && setting !== "off")
      .map(([rule]) => rule)
      .toSorted();
    expect(Object.keys(REGEXP_RULES).toSorted()).toStrictEqual(recommended);
  });

  it("zod：ZOD_RULES 逐条对上 recommended 规则（去掉不想挂的命名规则）", () => {
    const recommended = Object.entries(zod.configs?.["recommended"]?.rules ?? {})
      .filter(([, setting]) => setting !== "off")
      .map(([rule]) => rule)
      .filter((rule) => rule !== "zod/consistent-schema-var-name")
      .toSorted();
    expect(Object.keys(ZOD_RULES).toSorted()).toStrictEqual(recommended);
    expect(ZOD_RULES).not.toHaveProperty("zod/consistent-schema-var-name");
  });

  it("e18e：表里每条都真实存在，且不包含重复或方向相反的 9 条", () => {
    const pluginRules = new Set(Object.keys(e18e.rules ?? {}));
    for (const rule of Object.keys(E18E_RULES)) {
      expect(pluginRules.has(rule.slice("e18e/".length))).toBe(true);
    }
    const duplicateRules = [
      "prefer-array-at",
      "prefer-array-some",
      "prefer-date-now",
      "prefer-includes",
      "prefer-nullish-coalescing",
      "prefer-object-has-own",
      "prefer-regex-test",
      "prefer-spread-syntax",
      "prefer-string-fromcharcode",
    ];
    for (const rule of duplicateRules) {
      expect(E18E_RULES).not.toHaveProperty(`e18e/${rule}`);
    }
  });

  it("prefer-static-regex 只在生产 override 里开启", () => {
    expect(severity(BASE_RULES["e18e/prefer-static-regex"])).toBe("off");
    expect(PROD_OVERRIDES.rules?.["e18e/prefer-static-regex"]).toBe("error");
    expect(PROD_OVERRIDES.files).toStrictEqual(["lib/**", "src/**", "host.ts", "cli-main.ts"]);
  });
});
