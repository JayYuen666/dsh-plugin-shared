// lib/code-points.ts —— 代理对安全的**码点**截断。
//
// 为什么从 `text.ts` 拆出来：`text.ts` 值导入 `@deepseek-ai/dsh-output-retention`（宿主 peer），
// 而 `truncateCodePoints` 本身是零依赖纯函数。工具侧单一 `./tool` 在浏览器条件下只取纯件，
// 若它继续住在 `text.ts`，客户端构建会顺着 import 把宿主 peer 拖进 bundle。
//
// 码点口径（不是 UTF-16 码元）：emoji 与组合字符各算一个，适合「给模板留 N 个字」这类语义。
// `truncateEnd` / `truncateStart` 仍在 `text.ts`，它们按码元切并依赖官方前切件。

/**
 * 保留前 `maxChars` 个**码点**（不是码元）；`maxChars <= 0` 与 NaN ⇒ 空串。
 * @param text - 待截断的文本。
 * @param maxChars - 保留的码点数上限（非正数与 NaN 一律得空串）。
 * @returns 截断后的文本。
 */
export function truncateCodePoints(text: string, maxChars: number): string {
  // NaN 单独判：它与任何数比较都是 false，只剩 `maxChars < 1` 会让它一路走到
  // `counted >= NaN`（恒 false）而交回整串 —— 与「预算算错时不外泄」的约定相反。
  if (maxChars < 1 || Number.isNaN(maxChars)) {
    return "";
  }
  let end = 0;
  let counted = 0;
  // for..of 按码点迭代（每格 1–2 码元），与 `[...text].slice(…).join("")` 等价，
  // 但不触发 no-misused-spread / prefer-spread 两条互相打架的规则。
  for (const char of text) {
    if (counted >= maxChars) {
      break;
    }
    end += char.length;
    counted += 1;
  }
  return text.slice(0, end);
}
