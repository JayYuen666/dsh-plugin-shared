import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 挂载后的视图句柄。 */
export interface MountedView {
  container: HTMLDivElement;
  render: (next: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

/** 测试桩：明确的空回调。 */
export function noop(): void {
  /* 有意为空：测试桩。 */
}

/**
 * 挂载一个 React 元素到 happy-dom 容器。
 * @param element - 要渲染的元素
 * @returns 容器、重渲染与卸载函数
 */
export async function mount(element: ReactElement): Promise<MountedView> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async render(next: ReactElement): Promise<void> {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount(): Promise<void> {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/**
 * 取容器内第一个匹配节点的文本。
 * @param container - 容器
 * @param selector - 选择器
 * @returns 文本
 */
export function textOf(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? "";
}

/**
 * 在 act 中派发一个事件，让 React 的状态更新生效。
 * @param target - 事件目标
 * @param event - 事件
 */
export async function fire(target: EventTarget, event: Event): Promise<void> {
  await act(async () => {
    target.dispatchEvent(event);
  });
}

/**
 * 触发一次点击。
 * @param element - 目标节点
 */
export async function click(element: Element): Promise<void> {
  await fire(element, new MouseEvent("click", { bubbles: true }));
}

/**
 * 绕开 React 的 value tracker 写入新值并派发 input 事件。
 * @param element - 输入框或文本域
 * @param value - 新值
 */
export async function typeInto(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  await fire(element, new Event("input", { bubbles: true }));
}
