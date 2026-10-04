// lib/jsonl 单元测试：JSONL 尾部对半收缩的**纯**决策件。
// 为什么单独测：SP-D 把两份逐字符同义的写盘实现（ctx-observe 的 metrics 分片、lesson-loop 的
// lessons 落库）收敛成这一份决策，而两家的**触发策略与错误出口刻意不同、不能统一**
// （lesson-loop 出厂 maxBytes=0 = 永不截断，那是写进它 README 的承诺）。
// ⇒ 这里只钉"该留什么"，磁盘与异常归各包；期望值由实测算出而非手推。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { shrinkJsonlTail } from "../lib/jsonl.ts";

/** count 行、每行 `"k".repeat(width) + 序号`，末行无换行。 */
function rows(count: number, width = 30): string {
  return Array.from({ length: count }, (_row, index) => `${"k".repeat(width)}${index}`).join("\n");
}

/** 八行样本（23 字节 = 8×2 + 7 枚换行）：规模与收缩步进的共用底本。 */
const EIGHT_LINES = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8";
/** 上面对半一次之后的四行样本（11 字节 = 4×2 + 3 枚换行）。 */
const FOUR_LINES = "l5\nl6\nl7\nl8";
/** 再对半一次之后的两行样本（5 字节）。 */
const TWO_LINES = "l7\nl8";

describe("shrinkJsonlTail（按字节上限对半保留尾部行段）", () => {
  it("未超限 → 返回入参**同一引用**（调用方据此跳过写盘）", () => {
    const text = "ab\ncd\n";
    assert.equal(shrinkJsonlTail(text, 4096), text);
    assert.equal(shrinkJsonlTail("", 0), "");
  });

  it("对半收缩到 ≤maxBytes 且不切断行（形状搬自 ctx-observe/test/host.test.ts:1728-1748）", () => {
    const shrunk = shrinkJsonlTail(`${rows(400)}\n`, 1024);
    // 401 段经 201→101→51→26 四次对半收敛，末次起点是序号 375；850 字节 ≤ 1024。
    assert.equal(shrunk.split("\n").length, 26);
    assert.equal(Buffer.byteLength(shrunk, "utf8"), 850);
    assert.equal(shrunk.startsWith(`${"k".repeat(30)}375`), true);
  });

  it("单行超限 → 原样返回，防死循环也防清空（搬自 ctx-observe/test/host.test.ts:1750-1757）", () => {
    const text = `${"x".repeat(4096)}\n`;
    assert.equal(shrinkJsonlTail(text, 1024), text, "两行（含尾换行产生的空段）即止手");
  });

  it("keep 以换行开头 → 去掉前导换行，不产生空首行", () => {
    assert.equal(shrinkJsonlTail("a\n\nb", 2), "b");
    assert.equal(shrinkJsonlTail("aaaa\nbbbb\n\ncccc\n", 3), "cccc\n");
  });

  it("判据是 UTF-8 字节数而不是字符数", () => {
    const text = `${"汉".repeat(50)}\nsecond\nthird`;
    assert.equal(text.length, 63);
    assert.equal(Buffer.byteLength(text, "utf8"), 163);
    assert.equal(shrinkJsonlTail(text, 40), "second\nthird");
  });

  it("配额 0 与负数照样收缩到 ≤2 行为止——「0 = 永不截断」是调用方的触发策略，不是本函数的语义", () => {
    // lesson-loop 的出厂默认 maxBytes = 0 之所以表现为"永不截断"，是因为**它在调用前**
    // 就判了 `maxBytes > 0`（写进它 README 的承诺）。本函数只认循环判据：
    // 23 > 0 成立 ⇒ 一直对半到行数 ≤ 2 停手。这条把职责边界钉死，防止有人以为
    // "传 0 给它" 就等于关掉收缩——那会把 lesson-loop 的承诺写成一个假象。
    assert.equal(Buffer.byteLength(EIGHT_LINES, "utf8"), 23);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 0), TWO_LINES);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, -1), TWO_LINES, "负数同样进循环，不是提前退出");
    // 两行的输入则原地停手（行数 ≤ 2 的兜底），所以同一个 0 在不同输入上表现不同——
    // 这正是"不裁"必须由调用方保证的原因。
    assert.equal(shrinkJsonlTail("a\nb", 0), "a\nb");
  });

  it("非有限配额让比较恒假 ⇒ 整份原样返回；这一档由调用方保证", () => {
    // 任何数与 NaN / +Infinity 比较都是 false，所以循环一次都不进。这不是本函数该自作主张
    // 修的：http.readBody 为同一类错误加了 bad-budget 档，是因为那边不设限等于放开内存
    // 上限（请求体是攻击面）；这边不设限只是「这次不裁」。抛错会把一条清晰的预算错误塞进
    // 两个消费方各自的 catch（ctx-observe 上抛、lesson-loop 内部吞），反而更难排查。
    //
    // 两个真实消费方都不会把这种值传进来——具体调用点（本文件不会被发布，所以包名可以写
    // 在这儿；lib/jsonl.ts 的声明 JSDoc 里不能写，会随 .d.ts 发出去）：
    //   ctx-observe/host.ts:244   trimMetricsFile(file, maxBytes = METRICS_MAX_BYTES)
    //                             —— 固定常量作默认实参，非有限值进不来；
    //   lesson-loop/lib/jsonl-fuse.ts:21  trimJsonl(file, maxBytes)
    //     由 lesson-loop/lib/lesson-jsonl.ts:36 的 `maxBytes > 0` 把关，而它的 maxBytes
    //     在 lib/lesson-store.ts 的配额归一里已把非有限值与负数落成 0。
    // 但那道归一在消费方，本包不强制：新增消费方时没有东西会提醒它。契约写进 JSDoc 了，
    // 这里把它钉成用例，免得有人以为它已被处理。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(shrinkJsonlTail(EIGHT_LINES, bad), EIGHT_LINES, `配额 ${String(bad)} 不得收缩`);
      assert.equal(shrinkJsonlTail("a\nb", bad), "a\nb");
    }
    // 负无穷不是这一档：它让判据恒真，照常一路收缩到 ≤2 行为止。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, Number.NEGATIVE_INFINITY), TWO_LINES);
  });

  it("反复对半只丢整行，任何一轮都不会把一行切成两半", () => {
    // 恰好等于字节数（8×2 + 7 = 23）时判据 `>` 不成立 ⇒ 一行都不丢，这条等号侧也要钉。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 23), EIGHT_LINES);
    // 少一个字节才动：8 行 → 4 行 → 2 行，两轮之后停，每一步都落在整行边界上。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 22), FOUR_LINES);
    // 四行 = 4×2 + 3 枚换行 = 11 字节：限额 11 时等号侧不成立，原样返回；10 才再对半一次。
    assert.equal(Buffer.byteLength(FOUR_LINES, "utf8"), 11);
    assert.equal(shrinkJsonlTail(FOUR_LINES, 11), FOUR_LINES);
    assert.equal(shrinkJsonlTail(FOUR_LINES, 10), TWO_LINES);
    // 结果恒 ≤ 限额：限额 12 落在 11 字节那一档，不会为了凑满而多留半行。
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 12), FOUR_LINES);
    assert.equal(shrinkJsonlTail(EIGHT_LINES, 10), TWO_LINES);
  });

  it("行数 ≤ 2 时停手：单行与两行都原样交回（防死循环，也防清空文件）", () => {
    assert.equal(shrinkJsonlTail("", 0), "");
    assert.equal(shrinkJsonlTail("only", 0), "only");
    // 两行超限时停在两行上——按文档这是"宁可留超限也不清空"，调用方自己决定怎么处置。
    assert.equal(shrinkJsonlTail("a\nb", 0), "a\nb");
  });

  it("尾随换行算一格空行：行数比肉眼看多一行，收缩结果保留那个换行", () => {
    // "l1\nl2\nl3\n".split("\n") 是 4 段（末段为空串），所以 3 行的文件按 4 行收缩。
    assert.equal(shrinkJsonlTail("l1\nl2\nl3\n", 8), "l3\n");
    // 结果不带前导换行（那会让文件凭空多出一格空行），但保留末行的换行。
    const kept = shrinkJsonlTail("l1\nl2\nl3\n", 8);
    assert.ok(kept.endsWith("\n"), "末行换行要留着，写盘后仍是合法的行尾");
    assert.ok(!kept.startsWith("\n"), "不得凭空造出空首行");
  });
});
