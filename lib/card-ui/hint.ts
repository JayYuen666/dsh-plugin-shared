/**
 * 字段的设置值介绍统一送进 ⓘ 悬浮提示（设计稿口径：行内不放介绍文字，标签下只有控件，
 * 说明随 ⓘ 按钮 hover/键盘聚焦/点击钉住时展开）。
 * @param text - 完整说明
 * @returns 浮层详情（`detail` 位，FieldLabel 渲染成 ⓘ 按钮）
 */
export function splitHint(text: string): { hint?: string; detail?: string } {
  return { detail: text };
}
