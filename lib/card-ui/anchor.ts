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
