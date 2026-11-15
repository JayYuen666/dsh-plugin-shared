// lib/skill.ts 单元测试：虚拟 skill 注册的七条判据。
//
// 为什么这七条要分开钉：`registerSkill` 的返回布尔是调用方**唯一的**反馈通道（它不抛），
// 而四种失败里「服务缺席」与「形状不对」在调用方看来都是 false——若不在这里逐格验证，
// 把 `ctx.get` 写成 `ctx.get("skill")`、或把收窄判成「非 null 即可」，都不会有任何用例变红。
//
// 受影响的公共面：本文件只钉 `lib/skill.ts` 的 `registerSkill`（经 `package.json` 的
// `./lib/skill` 子路径导出，不进根 barrel）；同步面：`test/index.test.ts`（BARREL_EXEMPT）、
// `test/build-host.test.ts`（entries ↔ lib/ 的一一对应）各登记了本模块，那两条管的是清单
// 漂移，行为判据只在这里。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { registerSkill } from "../lib/skill.ts";

/** 一次 register 调用的记录：名字/说明/正文/来源，便于断言「原样转发、没有被改写」。
 *  `source` 是宿主 `validateDefinition()` 的必填项，独立成一名是为了让「少转发了它」
 *  在类型层就红，而不是等到宿主 `skill({ name })` 加载时抛 `source must be a string`。 */
interface Recorded {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly source: string;
}

/** 造一枚 skills 服务替身：`register` 记下每次调用并交回一个 no-op disposer。 */
function skillsService(recorded: Recorded[]): { register: (skill: Recorded) => () => void } {
  return {
    register(skill: Recorded): () => void {
      recorded.push(skill);
      return () => {
        // `registerSkill` 刻意丢弃注册返回的 disposer（skill 随插件 fiber 走），这里给个空实现。
      };
    },
  };
}

/** 造一个只有 `get` 的上下文替身；`provided` 决定 `ctx.get("skills")` 交回什么。 */
function contextOf(provided: unknown): { readonly get: (name: string) => unknown } {
  return {
    get: (name: string): unknown => (name === "skills" ? provided : undefined),
  };
}

const SPEC = { name: "zvec-grep", description: "检索规则", content: "正文" } as const;

describe("registerSkill", () => {
  it("服务在场时把四个字段原样转发（含宿主必填的 source），并回 true", () => {
    const recorded: Recorded[] = [];
    const ctx = contextOf(skillsService(recorded));
    assert.equal(registerSkill(ctx, SPEC), true);
    assert.deepEqual(recorded, [
      { name: "zvec-grep", description: "检索规则", content: "正文", source: "runtime" },
    ]);
  });

  it("转发的字段集满足宿主 validateDefinition 的必需面：四个键齐全且 source 是非空字符串", () => {
    // 这条不是「转发三字段」的重述，它是**针对宿主契约的守卫**：宿主的 `register()` 只补
    // `invocation` 与 `provider`，`source` 原样落进 candidate；`get()` 才走
    // `validateDefinition()`，那里对 source 有 `typeof !== "string"` 就抛。少这一位时注册
    // 照样成功、目录里照样能看到，只有模型真的去加载全文才炸——门禁与首屏都看不出来。
    const recorded: Recorded[] = [];
    const ctx = contextOf(skillsService(recorded));
    assert.equal(registerSkill(ctx, SPEC), true);
    const [forwarded] = recorded;
    assert.ok(forwarded !== undefined, "一次成功的注册必须真的调用 register");
    for (const required of ["name", "description", "content", "source"] as const) {
      assert.ok(required in forwarded, `转发对象缺少宿主必填字段 ${required}`);
    }
    assert.equal(typeof forwarded.source, "string");
    assert.notEqual(forwarded.source, "");
  });

  it("调用方给了 source 就用它，不覆盖成默认值", () => {
    const recorded: Recorded[] = [];
    const ctx = contextOf(skillsService(recorded));
    assert.equal(registerSkill(ctx, { ...SPEC, source: "@jayyuen66/dsh-zvec-grep" }), true);
    assert.equal(recorded[0]?.source, "@jayyuen66/dsh-zvec-grep");
  });

  it("服务缺席（精简 profile）时回 false 且不抛", () => {
    assert.equal(registerSkill(contextOf(undefined), SPEC), false);
  });

  it("交回来的东西形状不对时回 false：null、字符串、空对象、register 不是函数", () => {
    // 四格各自成一条是必要的：把收窄写成「非 null 即可」时只有后两条会红，
    // 写成「只要 typeof === object」时前两条仍然绿——它们量的是不同的东西。
    // 断言信息用下标而不是把值拼进字符串：`String(对象)` 会走默认的 [object Object]，
    // lint 会把那类插值判成「拿到的是你并不了解的形状」。
    const impostors: readonly unknown[] = [null, "skills", {}, { register: "not-a-function" }];
    for (const [index, bogus] of impostors.entries()) {
      assert.equal(registerSkill(contextOf(bogus), SPEC), false, `冒充形态 #${String(index)}`);
    }
  });

  it("正文为空时不注册：一次 register 都不该发生", () => {
    // 「空正文」出现在两种正常装配里（诊断全关 / 降级装配），此时注册一枚点开什么都没有的
    // skill 只会污染模型目录，所以这一格必须是「不调用」，而不是「调用但内容为空」。
    const recorded: Recorded[] = [];
    const ctx = contextOf(skillsService(recorded));
    assert.equal(registerSkill(ctx, { ...SPEC, content: "" }), false);
    assert.deepEqual(recorded, []);
  });

  it("每次调用只注册一枚，回执是布尔而不是 disposer", () => {
    const recorded: Recorded[] = [];
    const ctx = contextOf(skillsService(recorded));
    const first = registerSkill(ctx, SPEC);
    const second = registerSkill(ctx, { ...SPEC, name: "other" });
    assert.equal(typeof first, "boolean");
    assert.equal(first, true);
    assert.equal(second, true);
    assert.deepEqual(
      recorded.map((skill) => skill.name),
      ["zvec-grep", "other"],
    );
  });
});
