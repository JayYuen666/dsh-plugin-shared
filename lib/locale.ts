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

import type { BuiltInLocaleId } from "@deepseek-ai/dsh-client-locale";
import { isRecord } from "./record.ts";

/**
 * 支持的界面/模型侧文案语言。官方件是唯一定义源：`@deepseek-ai/dsh-client-locale` 的
 * `BuiltInLocaleId` 由它自己的 `LOCALE_IDS` 取下标得出，宿主哪天添一门语言时本包跟着走，
 * 不需要有人记得回来改这里的字面量联合。
 */
export type Locale = BuiltInLocaleId;

/** 缺省语言。设置项未设或值不合语法时落到这里。 */
export const DEFAULT_LOCALE: Locale = "zh";

/**
 * 官方 `@deepseek-ai/dsh-client-locale` 拥有的 settings 命名空间与字段名。那两枚常量官方
 * 也外销（同包的根入口），这里**不引它而是抄字面量**：引它就得把 client 包变成 host 半的运行期
 * 依赖，而这两个值是纯字符串常量、不参与任何 client 行为。两侧必须逐字同名才读得到同一份偏好，
 * 所以这条耦合是本包 README 的登记项：官方那两枚常量一旦改名，本包必须同步改。
 */
export const LOCALE_SETTINGS_NAMESPACE = "locale";
export const LOCALE_PREFERENCE_FIELD = "preference";

/**
 * 一个包的全部消息键值表（键名即语义，值是人读文案）。
 *
 * 键集绑 `Locale` 而不是手写 `{ zh; en }`：本文件的 `Locale` 已改成官方 `BuiltInLocaleId`
 * 的别名，宿主哪天加一门语言，这两处必须**一起**响——只改 `Locale` 而把键集钉死成
 * `{ zh; en }`，新增那门语言会静默取不到文案（`messagesFor` 的 else 分支落回 zh）。
 * `Record` 与原 interface 在当前 `Locale`（恰为 `"zh"｜"en"`）下结构等价，消费方字面量
 * 无需改动；差别只在宿主扩宽那一刻，从「静默回落」变成「编译报错」。
 *
 * 值域收在 string 上，用**同构映射类型**而不是 `Record<string, string>`：实测（tsc）消费方
 * 全部用 `interface Messages { readonly xxx: string }` 声明，而 interface **拿不到**隐式索引
 * 签名——写成 `Messages extends Record<string, string>` 会让全部消费方 TS2322，那是外溢到
 * 9 个包的破坏性变更。映射类型对 interface 与 type 都成立（test/type-guards.test.ts 钉住）。
 * 收窄前实测到的缺口：`messagesFor({ zh: { g: 1 }, en: { g: "x" } }, "zh")` 零错误通过，即文件头
 * 「值不是字符串都在 tsc 阶段就红」原本只在消费方自己声明 `Messages` 时才成立。
 */
export type MessagesCatalog<Messages> = Record<
  Locale,
  { readonly [Key in keyof Messages]: string }
>;

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
 *
 * 按 `locale` 直接索引而不是 `locale === "en" ? … : …` 的二元分派：后者的 else 分支
 * 把「非 en 即 zh」这个假设写死在运行期，`Locale` 扩宽时它**照样编译通过**，新增那门
 * 语言静默拿不到文案。与 `MessagesCatalog` 的 `Record<Locale, …>` 合起来，
 * 扩宽会在 `catalog[locale]` 这一处落成 TS2322。
 * @param catalog - 各语言齐全的消息表。
 * @param locale - 已归一的语言。
 * @returns 对应语言的消息表（引用返回，不做拷贝）。
 */
export function messagesFor<Messages>(
  catalog: MessagesCatalog<Messages>,
  locale: Locale,
): { readonly [Key in keyof Messages]: string } {
  // 返回值跟着 catalog 的值域走，而不是回到 Messages：TS 不能把同构映射类型反推回它的
  // 原泛型（实测会在这里报 TS2322）。两者结构等价，消费方 messagesFor(...).xxx 与把它
  // 赋给 Messages 类型的变量都不受影响，而值域仍然钉在 string 上。
  return catalog[locale];
}
