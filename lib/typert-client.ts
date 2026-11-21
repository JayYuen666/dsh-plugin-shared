// lib/typert-client.ts —— Typert Remote 客户端读取器的公共骨架。
//
// 收编标准见 README「逐字相同是收录标准」：以下三个单元此前在七个仓的客户端读取面里
// 逐字或 α-等价地出现（RemoteHost 七份、RemoteMounter 七份、isRemoteMounter 七份）；
// 骨架的其余位——descriptors、codec/schema、命名空间常量、unwrap 的宽严、错误文案、
// 挂载缓存语义（命名空间缺失时清不清缓存两派并存）——是各仓的领域判断，留在原地。
// `parseOrThrow` 同样达标但暂缓：它绑定 zod（`z.prettifyError`），收编等于给本包新增
// 第一个 zod 依赖面，取舍归 manifest 契约的裁决，见各仓现状。
//
// ⚠ 只在 `./lib/typert-client` 子路径上取用，**不进根 barrel**：本模块的类型面引用
// `@deepseek-ai/dsh-typert-protocol`（InvocationDescriptor），而根 barrel 的消费方里有
// 不装 typert 的插件（dsh-quality-gate）——照 lib/remote-marker.ts 的同一取舍。
import type { InvocationDescriptor } from "@deepseek-ai/dsh-typert-protocol";
import { isRecord } from "./record.ts";

/** 卡片所在宿主上下文里，读取器用到的那一位：显式读取一个可选服务。 */
export interface RemoteHost {
  get?: (name: string, strict?: boolean) => unknown;
}

/** 官方网关的客户端宿主服务：读取器只用 `$mount` 一位（挂载一枚手写贡献）。 */
export interface RemoteMounter {
  $mount: (contribution: {
    package: string;
    descriptors: readonly InvocationDescriptor[];
  }) => Promise<unknown>;
}

/** 这个值能当远程通道用吗（只核我们要调的那一位；服务来自别的实现或版本时保守当作没有）。 */
export const isRemoteMounter = (value: unknown): value is RemoteMounter =>
  isRecord(value) && typeof value["$mount"] === "function";
