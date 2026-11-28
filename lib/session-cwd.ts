// lib/session-cwd.ts —— 会话「当前工作区」的唯一读取口径。
//
// 为什么值得单点定义：ocr-review 与 zvec-grep 各写了一遍 98 tokens 的同构函数：
// 活目录优先（`ctx.workingDirectory.get(session)`），服务缺席或给不出非空串时回落
// `session.header.cwd`（创建期快照）。宿主 `cd` 之后只有前者会跟着变，所有按工作区
// 解析相对路径的判据都必须用这一份，否则会把目标归一到建会话时的旧目录。
//
// 形状按 unknown 收：跨进程/旧宿主递来的 agent 可能缺 session、缺 ctx，或者服务只装了
// 一半；这里只做「取得到就取、取不到就回落」，不抛。

import { hasMethods, hasOptionalMethods } from "./record.ts";

/** 官方工作目录服务的最小读取形状；`get` 缺席是合法的（服务可能只装了一半）。 */
export interface WorkingDirectoryFace {
  readonly get?: (session: unknown) => unknown;
}

/** 完整的工作目录服务：`get` 必须在场且可调用（严格判据）。 */
export interface WorkingDirectoryService extends WorkingDirectoryFace {
  readonly get: (session: unknown) => unknown;
}

/** 本函数用到的 agent 投影：只认 session/header/cwd 与 ctx.get 两条链。 */
export interface SessionCwdAgent {
  readonly session?: {
    readonly header?: {
      readonly cwd?: unknown;
    };
  };
  readonly ctx?: {
    readonly get?: (name: string, strict?: boolean) => unknown;
  };
}

/** 工作目录服务在场守卫：不是记录 ⇒ 没有服务；`get` 存在但不是函数 ⇒ 也不认。
 *
 * 导出给各仓直接用作 type predicate：它们此前各自抄了一份同样四行的局部守卫。
 * `get` 缺席是合法的（服务可能只装了一半），调用方用 `service.get?.()` 回落。
 */
export function isWorkingDirectory(value: unknown): value is WorkingDirectoryFace {
  return hasOptionalMethods(value, ["get"]);
}

/**
 * 严格的工作目录服务判据：`get` 必须在场且是函数。
 *
 * 与 {@link isWorkingDirectory} 的分工：那边允许 `get` 缺席，读取方用 `service.get?.()`
 * 自行回落；这里要求服务已经装全，适合把服务形状作为公开契约、下游不再做第二次判空的仓
 *（某个消费者仓把 `workingDirectoryOf` 的返回形状当公开契约用，就是这一档）。
 * @param value - 待验证的服务候选
 * @returns `get` 是可调用函数时为 true
 */
export function isWorkingDirectoryService(value: unknown): value is WorkingDirectoryService {
  return hasMethods(value, ["get"]);
}

/**
 * 会话当前工作区：活目录优先，服务缺席或给不出非空串时回落 `header.cwd`。
 * @param agent - 宿主交回的 agent 投影（可能整体缺席）
 * @returns 非空路径字符串，或 undefined
 */
export function sessionWorkingDirectory(
  agent: SessionCwdAgent | null | undefined,
): string | undefined {
  const session = agent?.session;
  // 这一跳可能是旧宿主/测试替身，ctx 缺席按「服务缺席」处理。
  const service: unknown = agent?.ctx?.get?.("workingDirectory");
  if (session !== undefined && isWorkingDirectory(service)) {
    const live: unknown = service.get?.(session);
    if (typeof live === "string" && live.length > 0) {
      return live;
    }
  }
  const raw: unknown = session?.header?.cwd;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
