// lib/locale.ts 单测：文案语言归一的每一条出口 + 两份消息表各自可达。
// 键集一致由 tsc 保证（zh / en 都标注同一个 Messages 类型），所以这里不需要
// 运行时比对——那种测试只会替编译期已经能守的东西占覆盖率。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  LOCALE_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE,
  messagesFor,
  resolveLocale,
  resolveLocalePreference,
} from "../lib/locale.ts";
import type { MessagesCatalog } from "../lib/locale.ts";
// 官方常量在**测试期**值导入。lib/locale.ts:31-35 拒绝在运行期引它（会把 schemastery+zod
// 拖进 host 半），但那条顾虑只对运行期成立：测试期引一次不产生任何产物字节，却把文件头自认的
// "官方改名本包必须同步改"从口头承诺变成会红的那道门。值已实测一致（'locale' / 'preference'）。
import {
  LOCALE_PREFERENCE_FIELD as OFFICIAL_PREFERENCE_FIELD,
  LOCALE_SETTINGS_NAMESPACE as OFFICIAL_SETTINGS_NAMESPACE,
} from "@deepseek-ai/dsh-client-locale";

interface TestMessages {
  readonly greeting: string;
  readonly refusal: string;
}

const catalog: MessagesCatalog<TestMessages> = {
  zh: { greeting: "你好", refusal: "已拦截" },
  en: { greeting: "hello", refusal: "blocked" },
};

describe("resolveLocale", () => {
  it("认得的字面量原样生效，并容忍大小写与首尾空白", () => {
    assert.equal(resolveLocale("en"), "en");
    assert.equal(resolveLocale("zh"), "zh");
    assert.equal(resolveLocale(" EN "), "en");
    assert.equal(resolveLocale("Zh"), "zh");
  });

  it("非字符串与不认得的值都退默认，而不是抛", () => {
    assert.equal(resolveLocale(""), DEFAULT_LOCALE);
    assert.equal(resolveLocale("fr"), DEFAULT_LOCALE);
    assert.equal(resolveLocale(undefined), DEFAULT_LOCALE);
    assert.equal(resolveLocale(42), DEFAULT_LOCALE);
    assert.equal(resolveLocale({ locale: "en" }), DEFAULT_LOCALE);
  });

  it("默认语言是中文", () => {
    assert.equal(DEFAULT_LOCALE, "zh");
  });

  // 官方偏好是 BCP 47 风格的自由串（dsh-client-locale 的 LOCALE_ID_PATTERN 容得下
  // zh-CN / en-US），而 client 半的解析规则是「先完整标签、再主语言子标签」。host 半
  // 必须同规则，否则选了 en-US 的人是英文界面 + 中文拒绝理由。
  it("完整标签不认得时按主语言子标签落位", () => {
    assert.equal(resolveLocale("en-US"), "en");
    assert.equal(resolveLocale("en-GB"), "en");
    assert.equal(resolveLocale("zh-CN"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("zh-Hans-CN"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("  EN-us  "), "en");
  });

  it("主语言子标签也不认得才退默认", () => {
    assert.equal(resolveLocale("fr-FR"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("-"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("en-"), "en");
  });
});

describe("resolveLocalePreference", () => {
  it("读官方 locale 命名空间里的 preference 字段", () => {
    assert.equal(resolveLocalePreference({ preference: "en" }), "en");
    assert.equal(resolveLocalePreference({ preference: "en-US" }), "en");
    assert.equal(resolveLocalePreference({ preference: "zh-CN" }), DEFAULT_LOCALE);
  });

  // 上游 `describe` 的返回形状由别的包拥有，这里不能假设它一定是对象。
  it("字段缺失、非对象与数组一律退默认", () => {
    assert.equal(resolveLocalePreference({}), DEFAULT_LOCALE);
    assert.equal(resolveLocalePreference(undefined), DEFAULT_LOCALE);
    assert.equal(resolveLocalePreference(null), DEFAULT_LOCALE);
    assert.equal(resolveLocalePreference(["en"]), DEFAULT_LOCALE);
    assert.equal(resolveLocalePreference("en"), DEFAULT_LOCALE);
  });

  // 断言对象是**官方导出的常量本身**，不是本包抄下来的字面量。写成后者时，用例名说的是
  // "与官方一致"，实际断言的却是本包自己——官方改名它照样绿，等于把要守的耦合排除在门外。
  it("命名空间与字段名与 dsh-client-locale 的常量一致", () => {
    assert.equal(LOCALE_SETTINGS_NAMESPACE, OFFICIAL_SETTINGS_NAMESPACE);
    assert.equal(LOCALE_PREFERENCE_FIELD, OFFICIAL_PREFERENCE_FIELD);
  });
});

describe("messagesFor", () => {
  it("两种语言各取到自己那份表", () => {
    assert.equal(messagesFor(catalog, "zh").refusal, "已拦截");
    assert.equal(messagesFor(catalog, "en").refusal, "blocked");
  });

  it("按引用返回，不复制表（每回合取文案不该有分配开销）", () => {
    assert.equal(messagesFor(catalog, "en"), catalog.en);
    assert.equal(messagesFor(catalog, "zh"), catalog.zh);
  });
});
