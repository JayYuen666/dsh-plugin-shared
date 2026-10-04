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
  LOCALE_IDS,
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

  it("分隔符只有连字符：下划线不是子标签分隔符（en_US 落默认）", () => {
    // 归一走 text.split("-") 取首段，所以只有 BCP-47 的连字符算数。下划线是 Windows 与
    // 若干系统 API 的历史写法；本函数按 BCP-47 判 ⇒ en_US 整体不认得，落默认语言。
    // 钉住它是为了让"要不要额外认下划线"成为一个有意识的决定，而不是某天顺手加的。
    assert.equal(resolveLocale("en_US"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("zh_Hans_CN"), DEFAULT_LOCALE);
    // 前导连字符让首段为空 ⇒ 判不出主语言；尾随连字符不影响首段。
    assert.equal(resolveLocale("-en"), DEFAULT_LOCALE);
    assert.equal(resolveLocale("en-"), "en");
    assert.equal(resolveLocale("--"), DEFAULT_LOCALE);
    // 繁体落 zh（与 DEFAULT_LOCALE 同值，但走的是"认得"那条路，故用字面量而非常量）。
    assert.equal(resolveLocale("zh-Hant-TW"), "zh");
  });

  it("非字符串一律退默认，不抛（设置里的原始值类型不可信）", () => {
    for (const raw of [undefined, null, 7, true, {}, [], Symbol("x"), Number.NaN]) {
      assert.equal(resolveLocale(raw), DEFAULT_LOCALE);
    }
    // 空串与纯空白同样退默认，而不是落成一枚空标签。
    assert.equal(resolveLocale(""), DEFAULT_LOCALE);
    assert.equal(resolveLocale("   "), DEFAULT_LOCALE);
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

describe("升级面：resolveLocale 的可认集合必须跟着官方 LOCALE_IDS 走", () => {
  it("官方 LOCALE_IDS 里每一门语言都能被 resolveLocale 认出来", () => {
    // 这条是本模块唯一真正的「宿主加语言」防线。现状：`Locale` 类型取自官方
    // `BuiltInLocaleId`（所以宿主加一门语言时，`MessagesCatalog` 会逼所有消费方补上那门
    // 的字典 —— 编译期报错，是响的），但 `resolveLocale` 的**取值**是自己写死的
    // `en`/`zh` 两个比较。宿主加了第三门语言时：类型变宽、消费方被迫补字典（响），
    // 而 resolveLocale 永远选不中它 —— 设置里选了那门语言的用户会静默拿到默认语言文案，
    // 没有任何测试会红。
    //
    // 这里不去改实现：`resolveLocale` 若改成从 LOCALE_IDS 取值，就得把 client 包变成 host
    // 半的**运行期**依赖（本文件头为另两枚常量刻意避开了这件事）。改成测试钉住，让升级
    // 时这道门**响**，由人决定「支持新语言」还是「明确不支持」，而不是静默取不到。
    // LOCALE_IDS 官方声明成元组（当前 `readonly ["zh", "en"]`），宿主加语言时类型跟着变成
    // 三元组，所以下面的循环**不可能空转**——不需要再加一条长度断言（那条会被
    // typescript/no-unnecessary-condition 判成恒真）。
    for (const id of LOCALE_IDS) {
      // 主语言子标签写法同样要落位（en-US / zh-Hans-CN 都归到主语言）。
      assert.equal(resolveLocale(id), id, `官方支持的 ${id} 却选不中`);
      assert.equal(resolveLocale(`${id}-XX`), id, `${id}-XX 应当落到 ${id}`);
    }
  });

  it("dEFAULT_LOCALE 必须是官方 LOCALE_IDS 里的成员", () => {
    // 兜底桶不能落在官方语言集合之外，否则某次升级移除 zh 之后它会变成一个没人认识的值。
    assert.ok(LOCALE_IDS.includes(DEFAULT_LOCALE), `${DEFAULT_LOCALE} 不在官方 LOCALE_IDS 里`);
  });
});
