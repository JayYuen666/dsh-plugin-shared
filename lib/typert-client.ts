// lib/typert-client.ts —— Typert Remote 客户端读取器的公共骨架。
//
// 收编标准见 README「逐字相同是收录标准」：以下三个单元此前在七个仓的客户端读取面里
// 逐字或 α-等价地出现（RemoteHost 七份、RemoteMounter 七份、isRemoteMounter 七份）；
// 骨架的其余位——descriptors、codec/schema、命名空间常量、unwrap 的宽严、错误文案、
// 挂载缓存语义（命名空间缺失时清不清缓存两派并存）——是各仓的领域判断，留在原地。
// `parseOrThrow` 也已收编：它原来绑定 zod（`z.prettifyError`），现在把 describe 作为
// 参数注入，本包因此仍然不新增 zod 依赖面。`remoteMounterOf` 是同一段
// 「try 读 remote → 判形状」的一段样板，九个消费仓共用；strict 显式传入，不替调用方决定缓存语义。
//
// ⚠ 只经 `./client` 取用，**不进根 barrel**：本模块的类型面引用
// `@deepseek-ai/dsh-typert-protocol`（InvocationDescriptor），而根 barrel 的消费方不都需要
// 这个值面——照 lib/remote-marker.ts 的同一取舍，别让只取根入口的宿主多解析一枚包。
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

/** 读取 `remote` 服务：任何读取异常都折成「没有远程通道」，不打断卡片装配。 */
export interface RemoteReaderContext extends RemoteHost {
  readonly get?: (name: string, strict?: boolean) => unknown;
}

/**
 * 从宿主上下文里取远程通道；缺席、形状不符、读取抛错都回 undefined。
 *
 * `strict` 显式传入而不是写死：`strict = false` 让服务在提供者 fiber 就绪前也可读
 *（设置卡可能在 fiber 就绪前挂上，不传 false 时 `ctx.get("remote")` 会回 undefined，
 * 卡片看起来像插件没装）；而有的仓刻意要 strict 默认值，收编不能替它们改语义。
 * @param ctx - 宿主上下文（可缺席）
 * @param strict - 是否只取「提供者当前 active」的实现
 * @returns 可用的远程通道，或 undefined
 */
export function remoteMounterOf(
  ctx: RemoteReaderContext | undefined,
  strict = false,
): RemoteMounter | undefined {
  let remote: unknown;
  try {
    remote = ctx?.get?.("remote", strict);
  } catch {
    remote = undefined;
  }
  return isRemoteMounter(remote) ? remote : undefined;
}

/** `schema.safeParse` 的成功分支；结构上兼容 zod 的 `ZodSafeParseSuccess`。 */
export interface SafeParseSuccess<Value> {
  readonly success: true;
  readonly data: Value;
}

/** `schema.safeParse` 的失败分支；`ErrorType` 由 schema 决定（zod 是 `ZodError`）。 */
export interface SafeParseFailure<ErrorType> {
  readonly success: false;
  readonly error: ErrorType;
}

/** 成功/失败的可判别联合；结构上兼容 zod 的 `ZodSafeParseResult`。 */
export type SafeParseResult<Value, ErrorType> =
  | SafeParseSuccess<Value>
  | SafeParseFailure<ErrorType>;

/** 只取 `safeParse` 一位的 schema 面：本包不引 zod，靠调用方注入 `describe`。 */
export interface SafeParser<Value, ErrorType> {
  readonly safeParse: (value: unknown) => SafeParseResult<Value, ErrorType>;
}

/**
 * `safeParse` 失败即抛 `TypeError`，失败文本由调用方注入。
 *
 * 为什么不把 `z.prettifyError` 写死：那会让 shared 新增第一个 zod 依赖面，而 shared 的
 * manifest 契约只允许 `dsh-fs-patch` 一枚普通依赖。调用点传 `z.prettifyError` 时，
 * `ErrorType` 由 `ZodType<T>` 推成 `ZodError`，不需要任何断言。
 * @param schema - 带 `safeParse` 的 schema
 * @param value - 待解析的值
 * @param describe - 把失败 error 转成人读文本
 * @returns 解析成功的数据
 */
export function parseOrThrow<Value, ErrorType>(
  schema: SafeParser<Value, ErrorType>,
  value: unknown,
  describe: (error: ErrorType) => string,
): Value {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(describe(parsed.error));
  }
  return parsed.data;
}
