// lib/with-timeout.ts —— 「限时等待、到点不再等但底层操作继续跑」的竞速骨架。
//
// 收编标准见 README「逐字相同是收录标准」：dsh-scrapling（lib/url-policy.ts）与
// dsh-dir-prep-organize（src/client-entry.ts）各有一份，剥掉一行拒绝值构造后逐字相同。
// 拒绝值按回调参数化——scrapling 的 label 拼串与 dir-prep 的本地化错误类型都是
// 用户可见文案，属领域判断留在调用方；骨架只保证两件共有的语义：计时器在两端
// （成功与超时）都清掉，不给事件循环留空转定时器；到点只是不再等待。
//
// 零依赖（setTimeout / Promise.withResolvers 浏览器与 Node 都可用）：宿主侧消费方
// 随 shared 外置取用，客户端侧消费方把这几行内联进自己的 bundle，两端都不是
// 新的依赖面。

/**
 * 给一次异步操作加超时保护。
 * @param promise - 要等的那次操作
 * @param timeoutMs - 超时毫秒数
 * @param onTimeout - 到点时构造拒绝值的回调；底层操作不可中止，到点后它仍在后台跑完
 * @returns 带超时保护的同一个结果
 */
export async function raceTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<Value> {
  const { promise: limit, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    reject(onTimeout());
  }, timeoutMs);
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}
