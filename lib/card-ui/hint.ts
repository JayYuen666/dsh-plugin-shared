/**
 * 把一段完整说明拆成常显提示与浮层详情。
 * 超过阈值的文案不进常显行，避免行内出现截断的省略号。
 * @param text - 完整说明
 * @param max - 常显阈值（字符数）
 * @returns 常显提示或浮层详情
 */
export function splitHint(text: string, max = 30): { hint?: string; detail?: string } {
  return text.length <= max ? { hint: text } : { detail: text };
}
