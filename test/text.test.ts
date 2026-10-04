// lib/text 单元测试：截断不得把代理对切成半。
// 为什么单独测：宿主把工具结果持久化进会话日志，一个孤立高代理会让该会话之后的
// 每次 Messages 请求都失败（上游同缺陷见 dsh PR #4827）。这里用字面量钉死两端的切法。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { truncateEnd, truncateStart } from "../lib/text.ts";

// 四枚边界即代理区：高代理 0xD800–0xDBFF、低代理 0xDC00–0xDFFF（按升序）。写十进制是因为
// oxfmt 小写 hex 数字、oxlint 又要求大写，两条 gate 在 hex 字面量上互斥（实测）。
const LONE_HIGH = 55_296;
const HIGH_CE = 56_319;
const LOW_START = 56_320;
const LOW_CE = 57_343;
// BMP 上界 0xFFFF：合法代理对被 codePointAt 合成一枚越过它的码点，逐枚扫时要连下半枚一起
// 跳过，否则那枚正常的低代理会被读成"孤立低代理"而假红。
const BMP_CE = 65_535;

describe("truncateEnd（前切，防尾部孤立高代理）", () => {
  it("切点落在高代理之后 ⇒ 丢掉该高代理", () => {
    const out = truncateEnd("审查结论：有问题\u{1F468}‍\u{1F469}", 9);
    assert.equal(out, "审查结论：有问题");
    const last = out.codePointAt(out.length - 1);
    assert.ok(
      !(last !== undefined && last >= LONE_HIGH && last <= HIGH_CE),
      `尾部仍是孤立高代理: 0x${last?.toString(16)}`,
    );
  });

  it("不超长 ⇒ 原样返回", () => {
    assert.equal(truncateEnd("短文本", 500), "短文本");
  });

  it("切点落在合法位置 ⇒ 保留完整代理对", () => {
    // 切点 4 正落在代理对**之后**（原文 6 码元 ⇒ 确实动了刀），完整对原样保留。
    assert.equal(truncateEnd("ab\u{1F600}cd", 4), "ab\u{1F600}");
  });

  it("零/负预算 ⇒ 空串（`maxChars <= 0` 时切点就是空串，不是整串）", () => {
    assert.equal(truncateEnd("abc", 0), "");
    assert.equal(truncateEnd("abc", -5), "");
    assert.equal(truncateEnd("", 0), "");
    // 下面三条里只有前两条是换装守卫的探针：官方裸函数实测
    // truncate("abcdefgh", -5) === "abc"、(-1) === "abcdefg"（slice 把负数解释成
    // "从尾部倒数"），摘掉 Math.max(0, ·) 这两条当场转红。第三条不是探针——
    // 实测 off("abcdefgh", -Infinity) === ""，与契约同值，摘守卫也不红；
    // 它钉的是"负无穷预算与负有限预算同口径落空串"这条契约边界，别把它当证据。
    assert.equal(truncateEnd("abcdefgh", -5), "");
    assert.equal(truncateEnd("abcdefgh", -1), "");
    assert.equal(truncateEnd("abcdefgh", Number.NEGATIVE_INFINITY), "");
  });

  it("NaN 预算 ⇒ 空串（与 truncateStart 同口径，文件头那句声明靠这一条成立）", () => {
    // 调用方把预算算成 `余量 - 已用量` 就可能交出 NaN（0/0、Infinity-Infinity）。
    // 这里不是钻空子：NaN 走不进 `text.length <= maxChars`，也不走 `slice(0, 0)`，
    // 它是**第三条**通路；两端必须逐条对上。
    assert.equal(truncateEnd("abc", Number.NaN), "");
    assert.equal(truncateEnd("abc\u{1F600}", Number.NaN), "");
  });
});

describe("truncateStart（后切，防首部孤立低代理）", () => {
  it("切点落在高代理与低代理之间 ⇒ 丢掉首部低代理，且保留量不塌陷", () => {
    const out = truncateStart("前置内容\u{1F468}‍\u{1F469}尾部内容", 8);
    assert.ok(
      out.length > 0,
      "返回空串会让下面的 codePointAt 取到 undefined 而假绿（vacuous pass）",
    );
    const first = out.codePointAt(0);
    assert.ok(
      !(first !== undefined && first >= LOW_START && first <= LOW_CE),
      `首部仍是孤立低代理: 0x${first?.toString(16)}`,
    );
    // 钉住"确实保留了尾部内容"，而不是只验证没坏
    assert.ok(out.includes("尾部内容"), `应保留尾部可见内容，实得 ${JSON.stringify(out)}`);
  });

  it("切点落在合法位置 ⇒ 预算原样保住", () => {
    // 与 truncateEnd 的合法切点用例对称：切点没切开代理对时一枚也不少削。
    assert.equal(truncateStart("前置内容\u{1F468}‍\u{1F469}尾部内容", 4), "尾部内容");
  });

  it("不超长 ⇒ 原样返回", () => {
    assert.equal(truncateStart("短文本", 500), "短文本");
  });

  it("零/负预算 ⇒ 空串，与 truncateEnd 同口径（不是把整串吐回去）", () => {
    assert.equal(truncateStart("abc", 0), "");
    assert.equal(truncateStart("abc", -5), "");
    assert.equal(truncateStart("", 0), "");
  });

  it("NaN 预算 ⇒ 空串，与 truncateEnd(text, NaN) 同口径", () => {
    // 改动前这里是"整串"：`NaN <= 0` 为 false 走不进守卫，`slice(-NaN)` 即 `slice(0)`。
    // 牙齿：把守卫写成 `minChars <= 0` 就这条红（两端"同口径"那句话又变成假话）。
    assert.equal(truncateStart("abc", Number.NaN), "");
    assert.equal(truncateStart("abc\u{1F600}", Number.NaN), "");
  });
});

describe("两端拼接（failureDetail 的用法）", () => {
  // 周期 24 枚码元的串，预算取 41 与 55：41 的正切点落在高代理上、55 的落在低代理上，
  // 两端都得被削掉一枚。旧的 40/40 两个切点都落在合法边界上，对**没截断过的原串**同样
  // 成立 ⇒ 把被测实现换成空操作，下面那条扫描也照样绿，根本咬不住。
  const detail = "错误：路径 /repo 校验失败\u{1F6D1}请修正后重试".repeat(30);

  it("预算各切进一枚半代理 ⇒ 两端长度各少 1（钉住确实动了刀）", () => {
    assert.equal(truncateEnd(detail, 41).length, 40, "尾部孤立高代理没被削掉");
    assert.equal(truncateStart(detail, 55).length, 54, "首部孤立低代理没被削掉");
  });

  it("头切 + 尾切拼起来后整串无孤立代理", () => {
    const joined = `${truncateEnd(detail, 41)}|${truncateStart(detail, 55)}`;
    let i = 0;
    while (i < joined.length) {
      const code = joined.codePointAt(i)!;
      if (code >= LONE_HIGH && code <= HIGH_CE) {
        assert.fail(`位置 ${i} 是孤立高代理`);
      }
      if (code >= LOW_START && code <= LOW_CE) {
        assert.fail(`位置 ${i} 是孤立低代理`);
      }
      i += code > BMP_CE ? 2 : 1;
    }
  });

  it("两端在无限预算下同口径：整串原样返回（而不是空串）", () => {
    // NaN 那一侧两条路径已经各有用例钉着；Infinity 是另一侧的"预算不可用"形态：
    // truncateStart 走 `text.length <= Infinity` 直接交回整串，truncateEnd 交给官方件
    // 的 slice(0, Infinity) 也交回整串。两者必须同向，否则"预算取自配置"时两端会分叉。
    const text = "abc\u{1F600}def";
    assert.equal(truncateStart(text, Number.POSITIVE_INFINITY), text);
    assert.equal(truncateEnd(text, Number.POSITIVE_INFINITY), text);
    // 负无穷归到"预算 ≤ 0"那一档 ⇒ 空串，与零预算同口径。
    assert.equal(truncateStart(text, Number.NEGATIVE_INFINITY), "");
    assert.equal(truncateEnd(text, Number.NEGATIVE_INFINITY), "");
  });

  it("空串与「预算恰好等于串长」两端都原样返回", () => {
    assert.equal(truncateEnd("", 0), "");
    assert.equal(truncateStart("", 0), "");
    assert.equal(truncateStart("", 5), "");
    assert.equal(truncateEnd("abc", 3), "abc");
    assert.equal(truncateStart("abc", 3), "abc");
    // 超出一格才动，且切点落在合法位置时保留量不塌陷。
    assert.equal(truncateEnd("abcd", 3), "abc");
    assert.equal(truncateStart("abcd", 3), "bcd");
  });
});

describe("兼容面：truncateEnd 依赖的官方件仍在装着的 DSH 里", () => {
  it("官方 truncateWithoutSplittingSurrogatePair 存在且可调用", async () => {
    // lib/text.ts 的文件头记着：官方件在 0.2.0-rc.2 存在、在 0.1.7-alpha.1 不存在。
    // 类型面挡得住"导出被删"（tsc 会红），但挡不住**运行期拿到 undefined**——例如
    // 消费插件装在另一份更老的 DSH 上。那种情况下 truncateEnd 会在第一次调用时抛
    // TypeError，而它的调用点全在把工具结果写进会话日志的路径上。
    // 本包把 DSH 依赖钉成精确版本（0.2.0-rc.2），但 9 个消费插件各自的 DSH 由宿主决定，
    // 所以这里把"符号存在且是函数"当成一条要钉的契约。
    const official = await import("@deepseek-ai/dsh-output-retention");
    assert.equal(typeof official.truncateWithoutSplittingSurrogatePair, "function");
    // 顺带钉住它确实是我们以为的那件事：切点切开代理对时丢的是尾部那枚孤立高代理。
    assert.equal(official.truncateWithoutSplittingSurrogatePair("a\u{1F600}", 1), "a");
    assert.equal(official.truncateWithoutSplittingSurrogatePair("a\u{1F600}b", 3), "a\u{1F600}");
  });
});
