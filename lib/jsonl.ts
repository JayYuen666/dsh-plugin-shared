// lib/jsonl.ts —— JSONL 尾部收缩的**纯**决策件：给定整份文本与字节上限，返回该留什么。
//
// 为什么只收内核不收写盘：SP-D 台架实测本仓两份实现（ctx-observe 的 shrinkMetricsFileSync
// 与 lesson-loop 的 trimJsonl）算法逐字符同义、穷举 413 组磁盘内容分歧 0，但两件事刻意不同、
// 统一即改变行为——**触发策略**（ctx-observe 每次追加前固定 5 MiB；lesson-loop 只在
// maxBytes > 0 时收缩，出厂默认 0 = 永不截断，那是写进它 README 的承诺）与**错误出口**
// （前者把异常抛给调用方、后者内部 catch 并打日志）。故写盘与触发留在各包。
// 本文件不碰 fs，与 README「lib/** 不写文件」的承诺一致。

/**
 * 反复保留后半行段直到 UTF-8 字节数 ≤ `maxBytes`；行数 ≤2 时停手（单条超限行原样保留，
 * 防死循环也防清空文件）。未超限直接返回入参**同一引用**，调用方可据此跳过写盘。
 * @param text 整份 JSONL 文本
 * @param maxBytes 字节上限
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
