// lib/jsonl.ts —— JSONL 尾部收缩的**纯**决策件：给定整份文本与字节上限，返回该留什么。
//
// 为什么只收内核不收写盘：本仓两份实现（ctx-observe 的 shrinkMetricsFileSync
// 与 lesson-loop 的 trimJsonl）算法逐字符同义、穷举 413 组磁盘内容分歧 0，但两件事刻意不同、
// 统一即改变行为——**触发策略**（ctx-observe 每次追加前固定 5 MiB；lesson-loop 只在
// maxBytes > 0 时收缩，出厂默认 0 = 永不截断，那是写进它 README 的承诺）与**错误出口**
// （前者把异常抛给调用方、后者内部 catch 并打日志）。故写盘与触发留在各包。
// 本文件不碰 fs，与 README「lib/** 不写文件」的承诺一致。

/**
 * 反复保留后半行段直到 UTF-8 字节数 ≤ `maxBytes`；行数 ≤2 时停手（单条超限行原样保留，
 * 防死循环也防清空文件）。未超限直接返回入参**同一引用**，调用方可据此跳过写盘。
 *
 * **配额必须是有限数**（这一档由调用方保证，本函数不代为归一）：
 *   - `0` 与负数**照样收缩**到 ≤2 行为止——「0 = 永不截断」是某消费方在**调用前**
 *     `maxBytes > 0` 那道触发策略的承诺，不是本函数的语义（见它自己的 jsonl-fuse 头注）。
 *     把 0 当成「不裁」会把这个承诺写成一个假象。
 *   - `NaN` 与 `+Infinity` 让 `字节数 > maxBytes` 恒假 ⇒ 循环一次都不进，整份原样返回，
 *     即**静默关掉收缩**。现存两个消费方都不会把这种值传进来：一个用固定常量作默认实参，
     另一个在调用前就把非有限值与负数归一成 0。但那道归一在**消费方**，本包并不强制——
     新增消费方时没有任何东西会提醒它。
 *
 * 为什么不改成 http.readBody 那样的 bad-budget 拒读：那边拒读是因为不设限等于放开内存
 * 上限（请求体是攻击面），这边不设限只是「这次不裁」。抛错会被两个消费方各自的 catch
 * 接走（一个上抛、一个内部吞），等于把一条清晰的预算错误变成一次静默跳过，排查方向
 * 反而更差。形状不同的同一种错，各按各的失败模型处理。
 *
 * 两个消费方的具体调用点与配额归一位置记在 test/jsonl.test.ts 的同名用例里——本文件头
 * 不能出现兄弟包标识符：那些名字会随 JSDoc 一起被 tsc 抄进 dist/types/*.d.ts 发出去，
 * 让装了这个包的消费方以为存在一个并不存在的依赖（test/publish-manifest.test.ts 会红）。
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
    current = keep.startsWith("\n") ? keep.slice(1) : keep;
  }
  return current;
}
