// lib/jsonl.ts —— JSONL 尾部收缩的**纯**决策逻辑：给定整份文本与字节上限，返回该留什么。
//
// 为什么只收内核不收磁盘写入：本仓两份实现（ctx-observe 的 shrinkMetricsFileSync
// 与 lesson-loop 的 trimJsonl）算法逐字符同义、穷举比对磁盘内容后无分歧，但两件事刻意不同、
// 统一即改变行为——**触发策略**（ctx-observe 每次追加前按固定配额收缩；lesson-loop 只在
// maxBytes > 0 时收缩，出厂默认 0 = 永不截断，那是写进它 README 的承诺）与**错误处理**
// （前者把异常抛给调用方、后者内部 catch 并打日志）。故磁盘写入与触发留在各包。
// 本文件不碰 fs，与 README「lib/** 不写文件」的承诺一致。

/**
 * 反复保留后半行段直到 UTF-8 字节数 ≤ `maxBytes`；行数 ≤2 时停手（单条超限行原样保留，
 * 防死循环也防清空文件）。未超限直接返回入参**同一引用**，调用方可据此跳过磁盘写入。
 *
 * **配额必须是有限数**（这一点由调用方保证，本函数不代为归一）：
 *   - `0` 与负数**照样收缩**到 ≤2 行为止——「0 = 永不截断」是某消费方在**调用前**
 *     `maxBytes > 0` 那道触发策略的承诺，不是本函数的语义（见它自己的 jsonl-fuse 头注）。
 *     把 0 当成「不裁」会把这个承诺写成一个假象。
 *   - `NaN` 与 `+Infinity` 让 `字节数 > maxBytes` 恒假 ⇒ 循环一次都不进，整份原样返回，
 *     即**静默关掉收缩**。现存两个消费方都不会把这种值传进来：一个用固定常量作默认实参，
     另一个在调用前就把非有限值与负数归一成 0。但那道归一在**消费方**，本包并不强制——
     新增消费方时没有任何东西会提醒它。
 *
 * 为什么不在这种预算上抛错拒收：抛错会被两个消费方各自的 catch 接走（一个向外抛、一个内部捕获），
 * 等于把一条清晰的预算错误变成一次静默跳过，排查方向反而更差。这里"不设限"只是「这次不裁」，
 * 不像读请求体那样会同时放开内存上限，所以没有必须拒收的那条失败方式。表现不同的同一种错，
 * 各按各的失败方式处理。
 *
 * 两个消费方的具体调用点与配额归一位置记在 test/jsonl.test.ts 的同名用例里——这一段
 * 不出现兄弟包标识符：声明上的 JSDoc 会被 tsc 抄进 dist/types/*.d.ts 一起发出去，
 * 包名会让装了这个包的消费方以为存在一个并不存在的依赖（test/publish-manifest.test.ts 会判定失败）。
 *
 * @param text 整份 JSONL 文本
 * @param maxBytes 字节上限；调用方须保证是有限数
 * @returns 收缩后的文本
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
    current = keep.replace(/^(?:\r?\n)+/u, "");
  }
  return current;
}
