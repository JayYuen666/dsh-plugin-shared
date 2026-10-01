import { describe, expect, it } from "vitest";
import {
  BASE_RULES,
  OFF_JUSTIFICATIONS,
  RETIRED_OFFS,
  SCRIPTS_OVERRIDES,
  TEST_FILE_OVERRIDES,
  TEST_OVERRIDES,
  VITEST_ASSERTION_DEFAULTS,
  definePluginConfig,
  makeTestFileOverrides,
} from "../config/oxlint.base.ts";
import type { OffReason, RuleTable } from "../config/oxlint.base.ts";

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

const KINDS: OffReason[] = [
  "契约冲突",
  "对侧互斥",
  "实测否证",
  "文体作用域",
  "上游不推荐",
  "零代价作废",
];

describe("definePluginConfig：关规则必须留依据", () => {
  it("出厂基线本身装载得动（每条 off 都在 OFF_JUSTIFICATIONS 里查到）", () => {
    expect(() => definePluginConfig()).not.toThrow();
  });

  it("包内把一条没登记的规则关成 off ⇒ 装载即抛，且错误点名该规则", () => {
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
            kind: "文体作用域",
            measured: 12,
            note: "只在夹具生成器里有意义",
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
    ).toThrow(/overrides\[3\]/u);
  });

  it('数组形态的关闭（["off"]）也走同一道判据，不被当成没关', () => {
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

  it("依据表里不许留已经不再关着的规则（表就是关规则的账，不是愿望清单）", () => {
    const stillOff = new Set([
      ...offKeys(BASE_RULES),
      ...offKeys(TEST_OVERRIDES.rules),
      ...offKeys(TEST_FILE_OVERRIDES.rules),
      ...offKeys(SCRIPTS_OVERRIDES.rules),
    ]);
    // 账上登记了依据、但没有任何地方真的关着它 = 愿望清单，不是账本
    const stale = Object.keys(OFF_JUSTIFICATIONS).filter(
      (rule) => !rule.endsWith("/*") && !stillOff.has(rule),
    );
    expect(stale).toStrictEqual([]);
  });

  it("标题开头术语走 prefer-lowercase-title 自带的 allowedPrefixes，不改测试名也不关规则", () => {
    // 只登记真正的技术名：实测 oxlint 1.86 是"前缀一命中就整条标题免检"（登记 CSRF 之后，
    // 一条首字母大写的坏标题照样放过），所以表每长一条就多一片免检面。规格 ticket 号已按 owner
    // 的口径从标题里删掉，中文开头的标题天然满足判据（无大小写），都不需要登记。
    // （口径细节：命中前缀之后下一个字符必须是术语边界，短一级的登记项如 Retry 会被门点名。）
    const override = makeTestFileOverrides({ titlePrefixes: ["UsageWatch", "CSRF"] });
    const setting = override.rules?.["vitest/prefer-lowercase-title"];
    expect(Array.isArray(setting) ? setting[1] : undefined).toStrictEqual({
      allowedPrefixes: ["UsageWatch", "CSRF"],
    });
    // 没报名字时这条设置退回基线的裸 "error"（默认口径不放宽）
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
    // 只替换 expect-expect 这一条：其余用例结构类判据原样带过来
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
