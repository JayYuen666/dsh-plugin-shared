/** 卡片控件的稳定 DOM id：每个实例自增，不依赖 React 的 useId。
 *
 * 为什么不用 `useId()`：插件测试用自带的渲染器展开组件树，并把 `react` 换成一套轻量 hook；
 * 共享包从自己的 node_modules 解析 React 时是另一份实例，`useId` 的 dispatcher 为 null。
 * 这个 id 只服务 `label[for]` 与 `aria-*`，进程内自增即可唯一，也没有 SSR 需求。 */
let sequence = 0;

/** 生成下一个卡片控件 id。 */
export function nextDomId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}
