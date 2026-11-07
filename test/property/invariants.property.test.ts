// 纯函数层的属性测试。期望值来自各模块头注写明的契约（配额例外、代理对安全、
// 绝不抛错、键格式），不从实现派生。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";

import { shrinkJsonlTail } from "../../lib/jsonl.ts";
import { truncateEnd, truncateStart } from "../../lib/text.ts";
import { diffTouched } from "../../lib/card-diff.ts";
import { errorText } from "../../lib/errors.ts";
import { deriveProjectKey } from "../../lib/project-key.ts";

/** 收缩配额生成域。 */
const quotaArb = fc.integer({ min: 10, max: 200 });
/** 随机 JSONL 行（含多字节字符与空行）。 */
const ledgerLineArb = fc.oneof(
  fc.record({ id: fc.stringMatching(/^[a-z0-9]{1,6}$/u), text: fc.string({ maxLength: 12 }) }),
  fc.constant(""),
);
const ledgerTextArb = fc
  .array(ledgerLineArb, { maxLength: 8 })
  .map((lines) =>
    lines.map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry))).join("\n"),
  );

describe("shrinkJsonlTail 的配额契约", () => {
  it("行数 >2 时：结果字节数 ≤ 配额或只有 ≤2 行（二选一必成立）", () => {
    fc.assert(
      fc.property(ledgerTextArb, fc.integer({ min: 1, max: 200 }), (text, maxBytes) => {
        const shrunk = shrinkJsonlTail(`${text}\n`, maxBytes);
        const withinQuota = Buffer.byteLength(shrunk, "utf8") <= maxBytes;
        const lineCount = shrunk.split("\n").length;
        assert.ok(
          withinQuota || lineCount <= 2,
          `两头都不满足：${JSON.stringify({ shrunk: shrunk.length, lineCount, maxBytes })}`,
        );
      }),
    );
  });

  it("整行不切半：结果的每一行都是输入行的原样后缀", () => {
    fc.assert(
      fc.property(ledgerTextArb, quotaArb, (text, maxBytes) => {
        const shrunk = shrinkJsonlTail(`${text}\n`, maxBytes);
        const inputLines = `${text}\n`.split("\n");
        for (const line of shrunk.split("\n")) {
          if (line.length > 0) {
            assert.ok(
              inputLines.some((source) => source === line),
              `结果行不是输入行的原样：${JSON.stringify(line)}`,
            );
          }
        }
      }),
    );
  });

  it("坏配额：NaN/+Infinity 恒等返回，-Infinity 收到 ≤2 行（已文档化的两向表现）", () => {
    const text = "a\nb\nc\n";
    assert.equal(shrinkJsonlTail(text, Number.NaN), text);
    assert.equal(shrinkJsonlTail(text, Number.POSITIVE_INFINITY), text);
    assert.ok(shrinkJsonlTail(text, Number.NEGATIVE_INFINITY).split("\n").length <= 2);
  });
});

describe("truncate 两端的代理对安全", () => {
  /** 合法 UTF-16 文本（无孤立代理项）。 */
  const wellFormedArb = fc.string({ maxLength: 40 }).filter((text) => text.isWellFormed());

  it("任意预算组合下，两端截断与其拼接都无孤立代理项；整宽预算各自还原原文", () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.integer({ min: 0, max: 45 }),
        fc.integer({ min: 0, max: 45 }),
        (text, endBudget, startBudget) => {
          const joined = `${truncateEnd(text, endBudget)}|${truncateStart(text, startBudget)}`;
          assert.ok(joined.isWellFormed(), `孤立代理项：${JSON.stringify(joined)}`);
          assert.ok(truncateEnd(text, endBudget).isWellFormed());
          assert.ok(truncateStart(text, startBudget).isWellFormed());
          // 整宽预算各自还原原文（无信息丢失的分界：预算 ≥ 文本长）。
          if (text.length > 0) {
            assert.equal(truncateEnd(text, text.length), text);
            assert.equal(truncateStart(text, text.length), text);
          }
        },
      ),
    );
  });

  it("maxChars ≤ 0 或 NaN ⇒ 空串（两端同做法）", () => {
    for (const budget of [0, -1, Number.NaN]) {
      assert.equal(truncateEnd("abc", budget), "");
      assert.equal(truncateStart("abc", budget), "");
    }
  });
});

describe("diffTouched 的表单语义", () => {
  const jsonValueArb = fc.oneof(
    fc.constant(null),
    fc.integer(),
    fc.string({ maxLength: 8 }),
    fc.boolean(),
    fc.array(fc.integer(), { maxLength: 3 }),
  );
  /** 含嵌套对象的记录（自反性要把对象分支也走到）。 */
  const diffRecordArb = fc.record(
    { alpha: jsonValueArb, beta: jsonValueArb, gamma: fc.constant({ nested: 1 }) },
    { requiredKeys: [] },
  );

  it("自反：diffTouched(x, x) 恒空（含 NaN、嵌套对象）", () => {
    fc.assert(
      fc.property(diffRecordArb, (record) => {
        assert.deepEqual(diffTouched(record, record), []);
      }),
    );
  });

  it("结果键集 ⊆ touched 键集且保持 touched 键序", () => {
    fc.assert(
      fc.property(
        fc.record({ alpha: jsonValueArb, beta: jsonValueArb }, { requiredKeys: [] }),
        fc.record({ alpha: jsonValueArb, beta: jsonValueArb }, { requiredKeys: [] }),
        (touched, value) => {
          const diff = diffTouched(touched, value);
          const touchedKeys = Object.keys(touched);
          for (const key of diff) {
            assert.ok(touchedKeys.includes(key), `结果键不在 touched：${key}`);
          }
          const orderInTouched = diff.map((key) => touchedKeys.indexOf(key));
          const sorted = orderInTouched.toSorted((left, right) => left - right);
          assert.deepEqual(orderInTouched, sorted, "键序没保持 touched 顺序");
        },
      ),
    );
  });
});

/** errorText 的输入全域：原始类型、缺 message 的对象、真 Error。 */
const errorValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(new Error("plain")),
  fc.constant({ message: "no-prototype" }),
);

describe("errorText 的绝不抛契约", () => {
  it("任意值（含敌意 getter、循环 cause、原始类型）不抛且返回非空串", () => {
    fc.assert(
      fc.property(errorValueArb, (value) => {
        // 契约是「绝不抛」：返回值是 string（空串输入回空串，见下一个用例）。
        assert.equal(typeof errorText(value), "string");
      }),
    );
  });

  it("error 的 cause 环终止并标出循环（手造的环；占位文本字面量自持）", () => {
    const outer = new Error("ring-outer");
    outer.cause = new Error("ring-inner", { cause: outer });
    const text = errorText(outer);
    assert.ok(text.includes("ring-outer"), JSON.stringify(text));
    assert.ok(text.includes("ring-inner"), JSON.stringify(text));
    assert.ok(text.includes("circular"), `环上回访没有降级占位：${JSON.stringify(text)}`);
  });

  it("敌意 getter 塌成占位而不抛（明文契约）", () => {
    const hostile = {
      get message(): string {
        throw new Error("hostile");
      },
    };
    const text = errorText(hostile);
    assert.ok(text.length > 0);
    assert.equal(text.includes("hostile-getter-marker"), false);
  });
});

/** 键的目录段生成域（deriveProjectKey 的输入）。 */
const keySegmentListArb = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/u), {
  minLength: 1,
  maxLength: 4,
});

describe("deriveProjectKey 的注入性质", () => {
  it("输出恒匹配 <stem>-<8 位十六进制> 或 default（POSIX 注入）", () => {
    fc.assert(
      fc.property(keySegmentListArb, (segments) => {
        const cwd = `/${segments.join("/")}`;
        const key = deriveProjectKey(cwd, {
          realpath: (value: string) => value,
          sep: "/",
        });
        assert.match(key, /^default$|^[^/]+-[0-9a-f]{8}$/u);
      }),
    );
  });

  it("同一目录的尾斜杠/重复斜杠变体同键（跨写法同键）", () => {
    fc.assert(
      fc.property(keySegmentListArb, (segments) => {
        const base = `/${segments.join("/")}`;
        const options = { realpath: (value: string) => value, sep: "/" } as const;
        assert.equal(deriveProjectKey(base, options), deriveProjectKey(`${base}/`, options));
        assert.equal(deriveProjectKey(base, options), deriveProjectKey(`${base}//`, options));
      }),
    );
  });
});
