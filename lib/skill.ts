// lib/skill.ts —— 把一份算好的正文注册成一枚**虚拟 skill**（宿主的 `ctx.skills.register()`）。
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
 * 注册上下文：只需要 `get`（读可选服务）与**可选**的 `effect`。
 *
 * `effect` 用来接管注册的生命周期：宿主的 `skills.register()` 交回一枚 disposer，不交回去
 * 就没人替我们撤销 —— 插件被卸载/热重载后 skill 仍留在模型目录里，下一次装配再注册同名条目
 * 只会被 first-wins 忽略（不只是白做，还让「卸载后目录里还在」变成既成事实）。所以拿到
 * disposer 就交给调用方的 fiber；`effect` 缺席（精简宿主、测试替身）时退化成「注册了但不管
 * 撤销」，与旧行为一致。`effect` 自己抛错（通常是 fiber 已 disposed）时，注册会立刻退回。
 */
export interface SkillRegistryContext {
  readonly get: (name: string) => unknown;
  readonly effect?: ((execute: () => () => void, label?: string) => unknown) | undefined;
}

/**
 * 把 `spec` 注册成一枚虚拟 skill。
 *
 * **本函数不抛**：注册失败只回 false。调用点把它包在 `apply` 里，异常穿出去会让整条 fiber 落
 * failed —— 一枚提示词组织用的 skill 不值得让插件装不上。宿主 `register` 的失败形态有两种：
 * 同名二次注册（卸载后重新装配、或双挂时单实例锁没拦住的那一瞬）与 `validateDefinition()`
 * 的校验拒绝，两者都按 false 处理。
 *
 * @param ctx - 必需 `get`；有 `effect` 时注册的撤销交给调用方 fiber
 * @param spec - 名字、目录说明、正文；正文为空时不注册
 * @returns true = 已交给宿主 `register`；服务缺席、形状不对、正文为空、注册抛错、effect 挂不上
 *   都为 false。同名 runtime skill 由宿主 first-wins 忽略时 `register` 仍会被调用，所以这里同样回 true。
 */
export function registerSkill(ctx: SkillRegistryContext, spec: SkillSpec): boolean {
  if (spec.content.length === 0) {
    return false;
  }
  const found = ctx.get("skills");
  if (!isSkillsFace(found)) {
    return false;
  }
  let dispose: (() => void) | undefined;
  try {
    dispose = found.register({
      name: spec.name,
      description: spec.description,
      content: spec.content,
      source: spec.source ?? DEFAULT_SKILL_SOURCE,
    });
  } catch {
    // 同名二次注册 / validateDefinition 拒绝：注册失败不是装配失败（见上文「本函数不抛」）。
    return false;
  }
  // 撤销权交给调用方 fiber。`effect` 的工厂是同步执行的，这里只把 disposer 交进去，不自己调。
  if (typeof dispose === "function") {
    try {
      ctx.effect?.(() => dispose, `registerSkill(${JSON.stringify(spec.name)})`);
    } catch {
      // effect 挂不上（通常是 ctx 已 disposed）：注册已经发生，但撤销没人执行。
      // 立刻退掉，否则 skill 会留在目录里；退不掉只能维持泄漏，仍按未注册回报。
      try {
        dispose();
      } catch {
        // 宿主已经不可用，dispose 也可能抛；不能把异常穿给 apply。
      }
      return false;
    }
  }
  return true;
}
