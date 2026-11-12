// lib/remote-marker.ts —— 标准装饰器的**程序化调用**：把 `@Remote("x")` 的标记打到类原型上，
// 源码因此不必引装饰器语法，消费方的构建与测试两条流水线都不必挂装饰器降级插件。
//
// 为什么值得单点定义：`markRemote` 在 dsh-zvec-grep / dsh-lesson-loop 各有一份 17 行的逐字
// 副本（md5 相同），dsh-scrapling 那份 14 行只差注释——三份都在做同一件事，且都在各自的注释里
// 解释同一套 TC39 形状。收进这里之后，三处只有调用点（`markRemote(X.prototype, "m")`），
// 形状解释只有这一份。
//
// 为什么是程序化调用而不是装饰器语法：`@Remote` 的全部作用就是往类原型写一枚描述符，而标准
// 装饰器语法需要一条 tsc 降级流水线（每个文件一次 tsc 子进程）。走程序化调用的消费方不需要
// 那条流水线，也不需要在 vitest.config.ts 里换掉 `definePackageConfig`。两者等价：这里
// `Reflect.apply` 的就是同一个 decorator 函数，落到同一个原型上。
//
// ⚠ 值导入：`Remote` 是个**函数**（不是纯类型），所以本模块的外部依赖落 peer（optional）而不是
// dependencies —— `dependencies` 由 test/publish-manifest.test.ts 钉着，插件运行期的宿主包一律
// 走 peer。产物里保持**裸说明符**（shared 的 build-host.mjs 按 dependencies ∪ peerDependencies
// 外部化），由消费方自己声明的那一份满足。
//
// ⚠ 只在 `./lib/remote-marker` 子路径上取用，**不进根 barrel**：根 barrel 的消费方里还有不装
// typert 的插件（dsh-quality-gate），把 typert 塞进 barrel 等于逼它们解析一枚用不到的包。

import { Remote } from "@deepseek-ai/dsh-typert-protocol";

/**
 * 把 {@link Remote} 的标记程序化地打到 `prototype[methodName]` 上。
 *
 * 官方 `Remote` 的运行时只读 `name` / `private` / `static` 与 `addInitializer`（TC39 的
 * `access` 与 `metadata` 它一概不读），故这里只给这四位到底。初始器只做
 * `Object.getPrototypeOf(this)` 后落标记，所以用原型造一枚替身实例即可。
 *
 * `Reflect.apply` 让装饰器工厂保持未类型化的调用签名 —— `Remote(name)` 的类型是
 * `RemoteMethodDecorator`，它要求第二个参数是真 `ClassMethodDecoratorContext`，而这里喂的是
 * 同形状的手写对象（平台类型不可构造）。
 * @param prototype - 目标类原型（`X.prototype`）
 * @param methodName - 要标记的实例方法名
 */
export function markRemote(prototype: object, methodName: string): void {
  const context = {
    kind: "method",
    name: methodName,
    static: false,
    private: false,
    addInitializer: (initializer: (this: unknown) => void): void => {
      Reflect.apply(initializer, Object.create(prototype), []);
    },
  };
  // oxlint-disable-next-line eslint/new-cap -- `Remote(…)` 是装饰器工厂，不是大写开头的构造调用
  const decorate = Remote(methodName);
  Reflect.apply(decorate, undefined, [Reflect.get(prototype, methodName), context]);
}
