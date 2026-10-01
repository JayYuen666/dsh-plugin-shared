// lib/locale.ts —— host 半的双语字典骨架：locale 归一 + 按 locale 取一份消息表。
//
// 只管 host 半：卡片/设置页的 UI 文案走官方 `@deepseek-ai/dsh-client-locale`
// （client 侧 `ctx.locale.register(ns, locale, dict)` + `bind`/`t` 席位，语言切换即时生效、
// 无需重挂载）。本模块的存在理由是 host 侧没有官方 i18n 面：注入段、拒绝理由、工具回显
// 这些由宿主进程产出的文案要双语，只能自己带字典。两侧同源靠 `LOCALE_SETTINGS_NAMESPACE`：
// 用户在「设置 → 常规」里选的偏好由官方包持久化在 settings 的 locale 命名空间，
// host 侧 describe 同一个命名空间即可跟上，不需要各包再开一个 locale 设置项。
//
// 键集一致**不靠测试**，靠类型：各包先声明 `type Messages = { readonly xxx: string }`，
// 再把 zh / en 两份都标注成 `Messages` 交给 messagesFor。少一个键、多一个键、
// 值不是字符串，都在 tsc 阶段就红——比运行时比对更早，也不给本仓 100% 覆盖率
// 门槛添任何不可达分支。
//
// 默认取中文：这些插件的拒绝理由与注入段长期以中文写作，英文是补齐而非替换。

import { isRecord } from "./record.ts";

/** 支持的界面/模型侧文案语言。 */
export type Locale = "zh" | "en";

/** 缺省语言。设置项未设或值不合语法时落到这里。 */
export const DEFAULT_LOCALE: Locale = "zh";

/**
 * 官方 `@deepseek-ai/dsh-client-locale` 在 Host settings 文档里拥有的命名空间与字段名
 * （其 `lib/index.js:5-7`）。这里是**抄常量不是引依赖**：那是宿主内部实现，没进公开
 * 依赖面，而两侧必须同名才能读到同一份偏好。
 */
export const LOCALE_SETTINGS_NAMESPACE = "locale";
export const LOCALE_PREFERENCE_FIELD = "preference";

/** 一个包的全部消息键值表（键名即语义，值是人读文案）。 */
export interface MessagesCatalog<Messages> {
  readonly zh: Messages;
  readonly en: Messages;
}

/**
 * 把设置里的原始值归一成受支持的 locale：按**主语言子标签**判定（`en-US`、`zh-Hans-CN`
 * 都落位），与 client 半「先完整标签、再主语言子标签」的规则同源；判不出来一律退
 * DEFAULT_LOCALE——文案语言不该成为报错面。
 * @param raw - 设置里的原始值，类型不可信（来自用户文档）。
 * @returns 归一后的 locale。
 */
export function resolveLocale(raw: unknown): Locale {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const [primary] = text.split("-");
  return primary === "en" || primary === "zh" ? primary : DEFAULT_LOCALE;
}

/**
 * 从 `ctx.settings.describe(LOCALE_SETTINGS_NAMESPACE)` 的返回值里取偏好并归一。
 * describe 出来的形状由别的包拥有，所以入参按 unknown 处理：非对象、数组、缺字段
 * 都走默认语言，不抛。
 * @param described - describe 的原始返回值（可能 undefined）。
 * @returns 归一后的 locale。
 */
export function resolveLocalePreference(described: unknown): Locale {
  const raw = isRecord(described) ? described[LOCALE_PREFERENCE_FIELD] : undefined;
  return resolveLocale(raw);
}

/**
 * 取某个语言下的消息表。
 * @param catalog - 两语齐全的消息表。
 * @param locale - 已归一的语言。
 * @returns 对应语言的消息表（引用返回，不做拷贝）。
 */
export function messagesFor<Messages>(
  catalog: MessagesCatalog<Messages>,
  locale: Locale,
): Messages {
  return locale === "en" ? catalog.en : catalog.zh;
}
