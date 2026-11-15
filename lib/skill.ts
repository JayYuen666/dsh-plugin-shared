// lib/skill.ts —— 把一份算好的正文注册成一枚**虚拟 skill**（rc.2 的 `ctx.skills.register()`）。
//
// 为什么值得单点定义：三个带常驻提示词的插件各自写了一遍同一段代码——`SkillsFace` 接口、
// `isSkillsFace` 的窄化判定、以及「取服务 → 判形状 → register → 回 true」的正文，去掉注释后
// 逐行同构，只在常量名与函数名上不同（其中一份还多一个「空正文不注册」的分支）。满足 README
// 「同一份样板在两处以上逐字相同地重复才收录进来」的标准。
//
// 服务是**可选**的：`@deepseek-ai/dsh-skill` 未装载（精简 profile）时 `ctx.get("skills")`
// 回 undefined，此时只是没有 skill 可加载，调用方的常驻摘要段照旧生效。所以这里只收 `get`
// 而不要求 skills 进 inject 依赖表：进了就把「有 skill 服务」变成插件的硬性前提。
// 同理，任何失败形态都回 false 而不抛——skill 只是提示词的组织方式，不该让装配失败。
//
// 正文为空时**不注册**：注册一枚空 skill 只会往模型目录里塞一条点开什么都没有的条目，而
// 「正文为空」出现在两种正常装配里——诊断信息全关，或降级装配时目标服务的正文还没算出来。

/** `ctx.get("skills")` 交回来的那一面（只取本模块用到的那一位）。
 *  官方 `SkillRegistry.register(skill): () => void` 见
 *  `@deepseek-ai/dsh-skill/lib/types/index.d.ts`；这里只声明调用的那一位。
 *
 *  **`source` 是必填的**，这是实测出来的：宿主的 `register()` 只补 `invocation` 与
 *  `provider` 两个默认值，`source` 原样落进 candidate，加载时 `get()` 走
 *  `validateDefinition()`，那里有 `if (typeof source !== "string") throw new
 *  SkillError('loaded skill "<name>" source must be a string')`。少这一位时注册**照样成功**、
 *  目录里也能看到这一条，只有模型真的去 `skill({ name })` 加载全文才炸——门禁与首屏都看不出来。 */
interface SkillsFace {
  readonly register: (skill: {
    readonly name: string;
    readonly description: string;
    readonly content: string;
    readonly source: string;
  }) => () => void;
}

/** 收窄判定：只认「有 register 且是函数」的对象，空对象不能冒充 skill 服务。 */
function isSkillsFace(value: unknown): value is SkillsFace {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const member: unknown = Reflect.get(value, "register");
  return typeof member === "function";
}

/** 一只 skill 的全部可填内容。`name` 走 kebab-case（宿主 `isSkillName` 的语法）。 */
export interface SkillSpec {
  /** skill 名，也是模型用 `skill({ name })` 加载时的入参。 */
  readonly name: string;
  /** 目录里那行说明；模型据此决定要不要加载。 */
  readonly description: string;
  /** 正文全文。为空时本函数不注册（见文件头）。 */
  readonly content: string;
  /** 目录分类。宿主 `SkillSource` 是开放联合（`... | (string & {})`），任意非空字符串都合法。
   *  缺省 `"runtime"`——运行时注册进来的那一档，也是官方向量里的第一个自然取值。 */
  readonly source?: string;
}

/** 缺省来源。宿主的 `SkillSource` 联合里有 `'runtime'`，语义就是「运行时注册」。 */
const DEFAULT_SKILL_SOURCE = "runtime";

/**
 * 把 `spec` 注册成一枚虚拟 skill。
 *
 * @param ctx - 只需 `get`（读可选服务），不要求 skills 进 inject
 * @param spec - 名字、目录说明、正文；正文为空时不注册
 * @returns true = 已交给宿主 `register`；服务缺席、形状不对、正文为空都为 false（不抛）。
 *   同名 runtime skill 由宿主 first-wins 忽略时 `register` 仍会被调用，所以这里同样回 true。
 */
export function registerSkill(
  ctx: { readonly get: (name: string) => unknown },
  spec: SkillSpec,
): boolean {
  if (spec.content.length === 0) {
    return false;
  }
  const found = ctx.get("skills");
  if (!isSkillsFace(found)) {
    return false;
  }
  found.register({
    name: spec.name,
    description: spec.description,
    content: spec.content,
    source: spec.source ?? DEFAULT_SKILL_SOURCE,
  });
  return true;
}
