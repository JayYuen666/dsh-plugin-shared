// lib/jsonl 单元测试：JSONL 尾部对半收缩的**纯**决策逻辑。
// 为什么单独测：收编时把两份逐字符同义的磁盘写入实现（ctx-observe 的 metrics 分片、lesson-loop 的
// lessons 落库）统一成这一份决策，而两家的**触发策略与错误处理刻意不同、不能统一**
// （lesson-loop 出厂 maxBytes=0 = 永不截断，那是写进它 README 的承诺）。
// 因此这里只固定"该留什么"，磁盘与异常归各包；期望值由实测算出而非手推。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { shrinkJsonlTail } from "../lib/jsonl.ts";

/** count 行、每行 `"k".repeat(width) + 序号`，末行无换行。 */
function rows(count: number, width = 30): string {
  return Array.from({ length: count }, (_row, index) => `${"k".repeat(width)}${index}`).join("\n");
}

/** 八行样本（23 字节 = 8×2 + 7 个换行）：规模与收缩步进的共用底本。 */
const EIGHT_LINES = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8";
/** 上面对半一次之后的四行样本（11 字节 = 4×2 + 3 个换行）。 */
const FOUR_LINES = "l5\nl6\nl7\nl8";
/** 再对半一次之后的两行样本（5 字节）。 */
const TWO_LINES = "l7\nl8";

describe("shrinkJsonlTail（按字节上限对半保留尾部行段）", () => {
  it("未发生裁剪 → 返回同一值（未超限，或超限但停在 ≤2 段/空段保护）", () => {
    const text = "ab\ncd\n";
    assert.equal(shrinkJsonlTail(text, 4096), text);
    assert.equal(shrinkJsonlTail("", 0), "");
    // 超限但只剩两段：同样原样交回，调用方不该为此写盘
    assert.equal(shrinkJsonlTail("abcdef\nghijkl", 3), "abcdef\nghijkl");
  });

  it("停手数的是 split 后的段数，不是记录数：尾换行会多算一段空串", () => {
    assert.equal(shrinkJsonlTail("{}\n{}", 3), "{}\n{}", "两段：停手，结果仍 5 字节");
    assert.equal(shrinkJsonlTail("{}\n{}\n", 3), "{}\n", "三段：裁到只剩末尾空段");
    assert.equal(shrinkJsonlTail("a\nb\nc\nd", 1), "c\nd");
    assert.equal(shrinkJsonlTail("a\nb\nc\nd\n", 1), "d\n");
  });

  it("对半收缩到 ≤maxBytes 且不切断行（形状搬自 ctx-observe 的同名用例）", () => {
    const shrunk = shrinkJsonlTail(`${rows(400)}\n`, 1024);
    // 401 段经 201→101→51→26 四次对半收敛，末次起点是序号 375；850 字节 ≤ 1024。
    assert.equal(shrunk.split("\n").length, 26);
    assert.equal(Buffer.byteLength(shrunk, "utf8"), 850);
    assert.equal(shrunk.startsWith(`${"k".repeat(30)}375`), true);
  });

  it("单行超限 → 原样返回，防死循环也防清空（搬自 ctx-observe 的同名用例）", () => {
    const text = `${"x".repeat(4096)}\n`;
    assert.equal(shrinkJsonlTail(text, 1024), text, "两段（含尾换行产生的空段）即止手");
  });

  it("keep 以换行开头 → 去掉前导换行，不产生空首行", () => {
    assert.equal(shrinkJsonlTail("a\n\nb", 2), "b");
    assert.equal(shrinkJsonlTail("aaaa\nbbbb\n\ncccc\n", 3), "cccc\n");
  });

  it("keep 前有连续空行时整段收掉，不留下以空行开头的首行", () => {
    // 对半拆分可能落在连续空行的中间：只 slice(1) 只去掉一个，结果仍以空行开头。
    assert.equal(shrinkJsonlTail("aaaa\n\n\n\nbbbb", 8), "bbbb");
    // 收紧到只剩两段时停手，也不会因为前导空行丢掉内容
    assert.equal(shrinkJsonlTail("aaaa\n\nbbbb\ncccc", 5), "bbbb\ncccc");
  });

  it("行尾是 CRLF 时同样收掉前导空行：旧实现只认 LF 前缀，遇到 CR 一次都命中不了", () => {
    // "aaaa\r\n" + 三个空行 + "bbbb"：keep 以 CR+LF 开头。
    assert.equal(shrinkJsonlTail("aaaa\r\n\r\n\r\n\r\nbbbb\r\ncccc", 12), "bbbb\r\ncccc");
  });

  it("判据是 UTF-8 字节数而不是字符数", () => {
    const text = `${"汉".repeat(50)}\nsecond\nthird`;
    assert.equal(text.length, 63);
    assert.equal(Buffer.byteLength(text, "utf8"), 163);
    assert.equal(shrinkJsonlTail(text, 40), "second\nthird");
  });

  it("多字节 UTF-8 的字节边界：恰好达标与超一字节", () => {
    // "汉" 3 字节；"a\n汉\n" 6 字节，保留 "汉\n" 是 4 字节。
    assert.equal(shrinkJsonlTail("a\n汉\n", 4), "汉\n", "恰好 4 字节达标");
    assert.equal(shrinkJsonlTail("a\n汉\n", 3), "汉\n", "差一字节也不切断字符，停在两段");
    // 两段时不再对半：5 字节的 "a\n汉" 在 5 字节原样，3 字节也不切
    assert.equal(shrinkJsonlTail("a\n汉", 5), "a\n汉");
    assert.equal(shrinkJsonlTail("a\n汉", 3), "a\n汉");
  });

  it("配额 0 与负数照样收缩到 ≤2 段为止——「0 = 永不截断」是调用方的触发策略，不是本函数的语义", () => {
    // lesson-loop 的出厂默认 maxBytes = 0 之所以表现为"永不截断"，是因为**它在调用前**
    // 就判了 `maxBytes > 0`（写进它 README 的承诺）。本函数只看循环条件：
    // 23 > 0 成立，于是一直对半到段数 ≤2 停手。这条把职责边界固定住，防止有人以为
    // "传 0 给它" 就等于关掉收缩——那会把 lesson-loop 的承诺写成一个假象。
    assert.equal(Buffer.byteLength(EIGHT_LINES, "utf8"), 23);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 0), TWO_LINES);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, -1), TWO_LINES, "负数同样进循环，不是提前退出");
    // 两段的输入则原地停手（段数 ≤2 的停止条件），所以同一个 0 在不同输入上表现不同——
    // 这正是"不裁"必须由调用方保证的原因。
    assert.equal(shrinkJsonlTail("a\nb", 0), "a\nb");
  });

  it("非有限配额让比较恒假 ⇒ 整份原样返回；这一档由调用方保证", () => {
    // 任何数与 NaN / +Infinity 比较都是 false，所以循环一次都不进。这不是本函数该擅自处理
    // 的：这边不设限只是「这次不裁」，不像读请求体那样会同时放开内存上限，因此没有必须
    // 拒收的那类失败。抛错会被消费方的错误出口接走——一条内部捕获并记日志、一条向外抛，
    // 同一种错在两条路上表现不同，反而不如把「不设限」写成明确契约。
    //
    // 两个真实消费方都不会把这种值传进来——具体调用点（本文件不会被发布，所以包名可以写
    // 在这儿；lib/jsonl.ts 的声明 JSDoc 里不能写，会随 .d.ts 发出去）：
    //   ctx-observe/host.ts   trimMetricsFile(file, maxBytes = METRICS_MAX_BYTES)
    //                             —— 固定常量作默认实参，只覆盖缺省调用；
    //   lesson-loop/lib/jsonl-fuse.ts  appendUnderFuse(file, payload, maxBytes)
    //     内部的 shrinkLocked 调本函数，`maxBytes > 0` 的门在 appendUnderFuse 里；
    //     lesson-store 的设置入口用 Number.isFinite 过滤非有限值（configure 忽略该键、
    //     setMaxLessonsBytes 归一成 0），构造入口由 settings schema 的 natural/max 约束。
    // 但这些兜底都在消费方，本包不强制：新增消费方时没有东西会提醒它。约定写进 JSDoc 了，
    // 这里把它固定成用例，免得有人以为它已被处理。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(shrinkJsonlTail(EIGHT_LINES, bad), EIGHT_LINES, `配额 ${String(bad)} 不得收缩`);
      assert.equal(shrinkJsonlTail("a\nb", bad), "a\nb");
    }
    // 负无穷不属于这一类：它让比较恒为 true，照常一路收缩到 ≤2 段为止。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, Number.NEGATIVE_INFINITY), TWO_LINES);
  });

  it("反复对半只丢整行，任何一轮都不会把一行切成两半", () => {
    // 恰好等于字节数（8×2 + 7 = 23）时判断 `>` 不成立，一行都不丢，这条等号侧也要固定。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 23), EIGHT_LINES);
    // 少一个字节才触发：8 行 → 4 行 → 2 行，两轮之后停，每一步都落在整行边界上。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 22), FOUR_LINES);
    // 四行 = 4×2 + 3 个换行 = 11 字节：限额 11 时等号侧不成立，原样返回；10 才再对半一次。
    assert.equal(Buffer.byteLength(FOUR_LINES, "utf8"), 11);
    assert.equal(shrinkJsonlTail(FOUR_LINES, 11), FOUR_LINES);
    assert.equal(shrinkJsonlTail(FOUR_LINES, 10), TWO_LINES);
    // 结果恒 ≤ 限额：限额 12 对应 11 字节的结果，不会为了凑满而多留半行。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 12), FOUR_LINES);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 10), TWO_LINES);
  });

  it("≤2 段或保留段全空白时停手：非空输入不会被裁成空串", () => {
    assert.equal(shrinkJsonlTail("", 0), "");
    assert.equal(shrinkJsonlTail("only", 0), "only");
    assert.equal(shrinkJsonlTail("a\nb", 0), "a\nb");
    // 尾部空行让对半后的保留段全是空白：停在当前文本，而不是返回 ""
    assert.equal(shrinkJsonlTail("{}\n\n", 1), "{}\n\n");
    assert.equal(shrinkJsonlTail("A\nB\n\n", 0), "A\nB\n\n");
    // 再裁一轮才会空：保留最后一条记录（连同它的尾随空行），不返回 ""
    const once = shrinkJsonlTail("A\nB\nC\n\n", 0);
    assert.equal(once, "C\n\n");
    assert.equal(shrinkJsonlTail(once, 0), once, "结果必须是不动点");
    // CRLF 同理：旧实现会返回 "\r\n"，这里保住记录
    assert.equal(shrinkJsonlTail("A\r\n\r\n", 1), "A\r\n\r\n");
    // 只有空格的保留段同样不能把前面的记录带走
    assert.equal(shrinkJsonlTail("A\n \n", 1), "A\n \n");
    // 全空白输入也不清空
    assert.equal(shrinkJsonlTail("\n\n\n", 1), "\n\n\n");
  });

  it("尾随换行算一格空段：段数比肉眼看多一段，收缩结果保留那个换行", () => {
    // "l1\nl2\nl3\n".split("\n") 是 4 段（末段为空串），所以 3 行的文件按 4 行收缩。
    assert.equal(shrinkJsonlTail("l1\nl2\nl3\n", 8), "l3\n");
    // 结果不带前导换行（那会让文件凭空多出一个空行），但保留末行的换行。
    const kept = shrinkJsonlTail("l1\nl2\nl3\n", 8);
    assert.ok(kept.endsWith("\n"), "末行换行要留着，写盘后仍是合法的行尾");
    assert.ok(!kept.startsWith("\n"), "不得凭空造出空首行");
  });
});
