// lib/jsonl.ts —— JSONL 尾部收缩的**纯**决策逻辑：给定整份文本与字节上限，返回该留什么。
//
// 为什么只收内核不收磁盘写入：抽取时两份旧实现（ctx-observe 的 shrinkMetricsFileSync 与
// lesson-loop 的 trimJsonl）算法逐字符同义、穷举比对磁盘内容后无分歧；此后本文件只在
// **前导空行**的处理上有过一次有意收紧（旧版最多剥一个 LF，现在剥掉整段 LF/CRLF 前缀，
// 见 LEADING_NEWLINES），保留的记录行内容不变。lesson-loop 现在经 jsonl-fuse 的
// appendUnderFuse/shrinkLocked 调用本函数。两条消费路径仍刻意不同、统一即改变行为——
// **触发策略**（一条每次追加前按固定配额收缩；另一条只在 maxBytes > 0 时收缩，出厂默认
// 0 = 永不截断，那是写进其 README 的承诺）与**错误处理**（一条把异常抛给调用方、另一条
// 由 shrinkLocked 内部 catch 并打日志）。故磁盘写入与触发留在各包。
// 本文件不碰 fs，与 README「运行期模块不写文件」的承诺一致。

/** 对半拆分后可能留下的前导换行（LF 与 CRLF 都认）。 */
const LEADING_NEWLINES = /^(?:\r?\n)+/u;

/** 判「保留段里还有没有实质内容」：整段都是空白（空行、CRLF、空格）就没有记录可留。 */
const HAS_CONTENT = /\S/u;

/**
 * 反复保留后半行段直到 UTF-8 字节数 ≤ `maxBytes`。停手条件：
 *   - `split("\n")` 后的段数 ≤2（尾换行会多算一段空串；单条超限行原样保留）；
 *   - 再裁一次会把保留段剥成空白——此时停在当前文本，宁可超限也**不清空文件**。
 * 所以 `maxBytes` 是触发裁剪的阈值，不是返回值的硬上限；任何非空输入都不会返回空串。
 *
 * 未发生裁剪（本来就没超限，或超限但停在上面两条）时返回入参**同一值**，调用方可据此
 * 跳过磁盘写入。
 *
 * **配额必须是有限数**（这一点由调用方保证，本函数不代为归一）：
 *   - `0` 与负数**照样收缩**到 ≤2 段为止——「0 = 永不截断」是某消费方在**调用前**
 *     `maxBytes > 0` 那道触发策略的承诺，不是本函数的语义。把 0 当成「不裁」会把这个
 *     承诺写成一个假象。
 *   - `NaN` 与 `+Infinity` 让 `字节数 > maxBytes` 永远不成立 ⇒ 循环一次都不进，整份原样
 *     返回，即**静默关掉收缩**。现存两个消费方都不会把这种值传进来：一个用固定常量作
 *     默认实参（只覆盖缺省调用），另一个在设置入口过滤/归一非有限值。但那些兜底都在
 *     **消费方**，本包并不强制——新增消费方时没有任何东西会提醒它。
 *
 * 为什么不在这种预算上抛错拒收：抛错会被消费方的错误出口接走，表现因路径而异——内部
 * 捕获并记日志的调用方会把预算错误变成一次静默跳过，不捕获的调用方则会被直接打断。同一
 * 种错在不同路径上本来就该按各自的失败纪律处理；这里"不设限"只是「这次不裁」，不像读
 * 请求体那样会同时放开内存上限，所以没有必须拒收的那条失败方式。
 *
 * 两个消费方的具体调用点与配额归一位置记在 test/jsonl.test.ts 的同名用例里——这一段
 * 不出现兄弟包标识符：声明上的 JSDoc 会被 tsc 抄进 dist/types/*.d.ts 一起发出去，
 * 包名会让装了这个包的消费方以为存在一个并不存在的依赖（test/publish-manifest.test.ts 会判定失败）。
 *
 * @param text 整份 JSONL 文本
 * @param maxBytes 字节上限；调用方须保证是有限数
 * @returns 收缩后的文本；非空入参不会返回空串
 */
export function shrinkJsonlTail(text: string, maxBytes: number): string {
  let current = text;
  while (Buffer.byteLength(current, "utf8") > maxBytes) {
    const lines = current.split("\n");
    if (lines.length <= 2) {
      break;
    }
    const keep = lines.slice(Math.floor(lines.length / 2)).join("\n");
    // 去掉 keep 前面的空行：对半拆分落在连续空行中间时会拆出一串前导换行，只 slice(1) 只去掉
    // 一个、结果仍以空行开头；CRLF 形态下 keep 以 `\r\n` 开头，`startsWith("\n")` 更是
    // 一次都命中不了。这里整段去掉，判断同时覆盖两种行尾。
    const candidate = keep.replace(LEADING_NEWLINES, "");
    // 保留段整段都是空白：再走一步就会把文件清成空串。停在 current（宁可超限），
    // 保证任何非空输入都不会被裁空——这是「防清空」唯一能兑现的形态。
    if (!HAS_CONTENT.test(candidate)) {
      break;
    }
    current = candidate;
  }
  return current;
}
