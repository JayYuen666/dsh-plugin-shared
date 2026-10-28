// lib/errors 单元测试：把 unknown 错误归一成界面文本。
// 这里逐条固定 errorChain 的五条语义：cause 链、AggregateError 成员、空 message 回退 name、
// 跨 realm 取自有 message、恶意 getter 改用占位文本。任何一条偏离都会让界面上丢掉真实失败原因。
import vm from "node:vm";
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { errorText, isSettingsConflict } from "../lib/errors.ts";

/** 恶意对象/toString 拿不到值时的统一占位文本。 */
const UNRENDERABLE = "<unrenderable value>";
/** cause 环上回访时的占位文本。 */
const CIRCULAR = "<circular cause>";
/** 无可读 message 的普通对象由 String() 处理后的样子。 */
const OBJECT_STRING = "[object Object]";

describe("errorText（unknown 错误的界面文本归一）", () => {
  it("本域 Error 取 message；非对象值按 String() 兜底", () => {
    const detail = "root 必填，且为工作区绝对路径";
    assert.equal(errorText(new Error(detail)), detail);
    assert.equal(errorText("plain rejection"), "plain rejection");
    assert.equal(errorText(409), "409");
    assert.equal(errorText(null), "null");
  });

  it("空 message 回退 name，否则界面只拿到空字符串", () => {
    const bare = new Error("构造器总要一句，这里之后被抹掉");
    bare.message = "";
    assert.equal(errorText(bare), "Error");
    // 子类不显式设 name 时继承的是 Error.prototype.name，所以这里自己声明
    const named = new Error("有 message，走不到回退");
    named.name = "NamedFailure";
    assert.equal(errorText(named), "有 message，走不到回退");
    named.message = "";
    assert.equal(errorText(named), "NamedFailure");
  });

  it("跨 realm 的 Error 取自有 message，不吃 instanceof", () => {
    const alien: unknown = vm.runInNewContext("new Error('alien boom')");
    assert.equal(alien instanceof Error, false, "前提：确为跨 realm 对象");
    assert.equal(errorText(alien), "alien boom");
  });

  it("非 Error 但带可读 message 属性的对象取该属性", () => {
    assert.equal(errorText({ message: "from object" }), "from object");
    // 无可读 message 时回到 String()，不返回 undefined
    assert.equal(errorText({ code: 1 }), OBJECT_STRING);
    // message 是访问器而非数据属性时同样取不到，回到 String()
    const accessor = {
      get message(): string {
        throw new Error("不该被调用");
      },
    };
    assert.equal(errorText(accessor), OBJECT_STRING);
  });

  it("非 Error 对象 message 是空串时落 String()，不留一片空白", () => {
    // 空串不能算「读到了 message」：直接 return "" 会让界面只拿到空白，
    // 与「Error 的 message 为空串时回退 name」是同一个理由。
    assert.equal(errorText({ message: "" }), OBJECT_STRING);
    assert.equal(errorText({ message: "", code: 1 }), OBJECT_STRING);
    // 非空串照常取
    assert.equal(errorText({ message: "有内容" }), "有内容");
  });

  it("cause 链按由外到内拼接", () => {
    const root = new Error("根因");
    const middle = new Error("中层", { cause: root });
    const outermost = new Error("最外", { cause: middle });
    assert.equal(errorText(outermost), "最外: 中层: 根因");
    const pair = new Error("外", { cause: new Error("内") });
    assert.equal(errorText(pair), "外: 内");
  });

  it("包装层逐字重复自己的 message 时不把 cause 再渲染一遍", () => {
    const echoed = new Error("dup", { cause: new Error("dup") });
    assert.equal(errorText(echoed), "dup");
  });

  it("cause 为 null 与 cause 缺失都按「无 cause」处理", () => {
    const explicitNull = new Error("m");
    explicitNull.cause = null;
    assert.equal(errorText(explicitNull), "m");
    assert.equal(errorText(new Error("m")), "m");
  });

  it("aggregate 类错误的成员附在 message 之后；空成员表不产生空括号", () => {
    const members = [new Error("e1"), new Error("e2")];
    assert.equal(errorText(new AggregateError(members, "multi")), "multi [e1; e2]");
    assert.equal(errorText(new AggregateError([], "none")), "none");
    // 非 aggregate 的错误没有成员列表，因此没有成员段
    assert.equal(errorText(new Error("plain")), "plain");
  });

  it("cause 环上的回访降级为占位文本，不会无限递归", () => {
    const outer = new Error("A");
    outer.cause = new Error("B", { cause: outer });
    assert.equal(errorText(outer), `A: B: ${CIRCULAR}`);
  });

  it("菱形共享的同一个 cause 在每条支路上都完整渲染", () => {
    const shared = new Error("s", { cause: new Error("leaf") });
    const branches = [shared, shared];
    assert.equal(errorText(new AggregateError(branches, "d")), "d [s: leaf; s: leaf]");
  });

  it("无原型对象的 toString 抛错时降级为占位文本，绝不外抛", () => {
    assert.equal(errorText(Object.create(null)), UNRENDERABLE);
  });

  it("敌意 message getter 降级为占位文本", () => {
    // Error 构造器建的是**自有** message 数据属性，会遮蔽原型上的 getter，
    // 所以恶意 getter 必须自己 defineProperty 到实例上才读得到
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", {
      configurable: true,
      get() {
        throw new Error("取不到");
      },
    });
    assert.equal(errorText(hostile), UNRENDERABLE);
  });

  it("敌意 cause 只塌掉出错的那一节，外层仍渲染得出", () => {
    const hostile: object = {
      toString() {
        throw new Error("转不动");
      },
    };
    assert.equal(errorText(new Error("外", { cause: hostile })), `外: ${UNRENDERABLE}`);
  });

  it("超深的 cause 链撞上栈上限时降级成占位文本，而不是把 RangeError 抛给调用方", () => {
    // `path` 那个 Set 只拦**环**，不拦深度：一条 5 万层的链是有限无环的，递归会一路走到
    // 栈溢出。栈溢出抛出的 RangeError 恰好落在每个 render 帧自己的 try 里，于是最深那一节
    // 变成占位文本、外层照样拼完——实测 5 万层输出 35708 字、耗时 52ms、不抛。
    // 这条要固定的是"不抛"：errorText 的调用点全在 catch 之后（通知、面板、日志），
    // 一旦它自己抛，宿主就再也拿不到那句人读文本了。
    let deep: Error = new Error("leaf");
    for (let level = 0; level < 50_000; level += 1) {
      deep = new Error(`L${String(level)}`, { cause: deep });
    }
    let rendered = "";
    assert.doesNotThrow(() => {
      rendered = errorText(deep);
    });
    assert.equal(typeof rendered, "string");
    assert.ok(rendered.includes(UNRENDERABLE), "爆栈那一节降级为占位文本");
    assert.ok(rendered.startsWith("L49999: "), "最外层仍按原样渲染");
  });

  it("中等深度的 cause 链完整渲染到最内层（别让上面那条把正常深度也钉成降级）", () => {
    let deep: Error = new Error("leaf");
    for (let level = 0; level < 500; level += 1) {
      deep = new Error(`L${String(level)}`, { cause: deep });
    }
    const rendered = errorText(deep);
    assert.ok(rendered.endsWith(": leaf"), "由外到内一路拼到最内层");
    assert.ok(!rendered.includes(UNRENDERABLE), "这个深度不该触发降级");
  });
});

describe("isSettingsConflict（设置冲突那一类失败）", () => {
  it("认 code 那一形", () => {
    assert.equal(isSettingsConflict({ code: "SETTINGS_CONFLICT" }), true);
  });

  it("认 name 那一形：跨 realm 抛来的错误类不是同一个构造函数", () => {
    assert.equal(isSettingsConflict({ name: "SettingsConflictError" }), true);
  });

  it("两形都不是则否，敌意形状不从这里抛", () => {
    assert.equal(isSettingsConflict(new Error("boom")), false);
    assert.equal(isSettingsConflict(null), false);
  });

  it("敌意 getter 与 Proxy 陷阱都不外抛，一律判否", () => {
    // `fieldOf` 走原型链读属性，所以这两种写法都会真的触发 get trap；读取抛错由
    // fieldOf 的带保护出口变成「取不到」（lib/record.ts），判定因此只回答是/否。
    // 调用点全在 catch 之后，拿它决定要不要走「设置冲突」那一支。
    assert.equal(
      isSettingsConflict({
        get code(): string {
          throw new Error("取不到");
        },
      }),
      false,
    );
    assert.equal(
      isSettingsConflict(
        new Proxy(
          {},
          {
            get() {
              throw new Error("陷阱");
            },
          },
        ),
      ),
      false,
    );
    // 对照：同一种输入交给 errorText 也不抛（两条出口约定一致）
    assert.equal(
      errorText({
        get code(): string {
          throw new Error("取不到");
        },
      }),
      OBJECT_STRING,
    );
  });
});
