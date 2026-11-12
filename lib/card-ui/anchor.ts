/// <reference lib="dom" />

/** 浏览器是否支持 CSS anchor 定位（宿主 webview 支持，与宿主 Menu 同一套平台 API）。
 *  支持时浮层位置由 `position-area` 跟随触发器，缩放/平移不漂；happy-dom 等不支持处回退 JS 矩形。
 *  探测的是本组件实际依赖的 `position-area`，不是更早出现的 `anchor-name`：只支持
 *  `anchor-name` 的半档实现里浮层不会被真正定位。happy-dom 的 CSS.supports 对 anchor-name
 *  误返 true，但它并不真做 anchor 布局；happy-dom 在 window 上暴露 happyDOM 属性，据此排除
 *  （真实浏览器没有该属性）。 */
export function cssAnchorSupported(): boolean {
  if ("happyDOM" in globalThis) {
    return false;
  }
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("position-area: block-end")
  );
}
/** 几何判据的容差（px）：亚像素舍入、1px 边框与缩放都不该触发回退。 */
export const ANCHOR_PLACEMENT_TOLERANCE = 2;

/**
 * 锚定之后浮层是否真的落在触发器上。
 *
 * cssAnchorSupported() 只回答「这个引擎认识这套 CSS」，不回答「这条规则最终有没有生效」。
 * 0.2.5–0.2.6 的事故形态就是后者：规则写法（span-inline-start）把浮层钉到视口左边缘，
 * 而引擎完全支持它，于是没有任何一层会报错——只有实测矩形看得见。宿主若用更高优先级的
 * 规则覆盖 position-area，症状相同（元素仍是 position:fixed，没有 left/top 时落到静态
 * 位置即视口左侧）。
 *
 * 判据用「对齐」而不是「坐标相等」：flip-inline 会把浮层改成与触发器右边缘对齐，所以
 * 行内起始边或结束边任一重合即算贴住；块向则要求不重叠（flip-block 翻到上方时浮层的
 * 下边缘贴在触发器上边缘）。两条都不成立时调用方改用 JS 矩形定位。
 * @param trigger - 触发器（下拉按钮 / 说明按钮）的矩形
 * @param floating - 浮层（候选列表 / 说明浮层）的矩形
 * @returns 浮层没有贴住触发器时为 true
 */
export function anchorPlacementOff(trigger: DOMRect, floating: DOMRect): boolean {
  const inlineStart = Math.abs(floating.left - trigger.left) <= ANCHOR_PLACEMENT_TOLERANCE;
  const inlineEnd = Math.abs(floating.right - trigger.right) <= ANCHOR_PLACEMENT_TOLERANCE;
  if (!inlineStart && !inlineEnd) {
    return true;
  }
  const below = floating.top >= trigger.bottom - ANCHOR_PLACEMENT_TOLERANCE;
  const above = floating.bottom <= trigger.top + ANCHOR_PLACEMENT_TOLERANCE;
  return !below && !above;
}
