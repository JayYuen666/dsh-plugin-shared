// lib/http.ts —— webServer 端点样板（各插件重复实现，已收敛到 shared）。
//
// 收敛来源（逐字同构）：session-rescue / lesson-loop / zvec-grep / ocr-review /
// ctx-observe 的 sendJson / isCrossOrigin / queryParam / readBody / checkCsrf。
// 设计：纯函数、零依赖、只依赖 node 内建类型；CSRF header 名由调用方传入
// （各插件历史 header 名不同，收敛时保持各自语义，不强行统一名）。

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

/**
 * 下面的 header 读取 helper 不只被真 `IncomingMessage` 调用：`test/trust*.test.ts` 手搓合成
 * 请求、以及非 node:http 的适配层都会传只带部分字段的对象。Node 的类型把 `headers` /
 * `socket` 都标成必存在，照抄那个形状会让类型面比现实更乐观 —— 运行时不得不写 `?.` 自卫，
 * 而那条自卫又会被类型感知规则判成冗余。所以这里如实声明可缺字段的入参类型。
 */
export interface PartialRequest {
  readonly headers?: IncomingHttpHeaders;
  readonly socket?: { readonly remoteAddress?: string | undefined } | null;
  readonly url?: string | undefined;
}

/** helper 接受的请求：真 `IncomingMessage` 或合成片段。 */
export type HttpRequest = IncomingMessage | PartialRequest;

/** 写 JSON 响应（no-store：端点都是运行时状态，禁缓存防陈旧）。
 * 已发头/已结束则静默跳过：同一响应被写两次会抛 ERR_HTTP_HEADERS_SENT，
 * 而端点多在 async 回调里，抛错变成 unhandled rejection 拖垮共享的 web host。 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

/** 读单值请求头：重复头取首项，非字符串/无 headers 面（部分 mock）归空串。 */
function headerValue(req: HttpRequest, name: string): string {
  const value = req.headers?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
}

/**
 * CORS 同源纵深防御：浏览器请求带 sec-fetch-site，非 same-origin/none 即拒绝。
 * 空头（curl/CLI）不拦——浏览器侧伪造不了同源判定，CLI 是本地可信调用面。
 */
export function isCrossOrigin(req: IncomingMessage): boolean {
  const site = headerValue(req, "sec-fetch-site");
  return site !== "" && site !== "same-origin" && site !== "none";
}

/** 从 req.url 读 query 参数（URLSearchParams 语义：+ 解码空格、尊重 ; 分隔等）。 */
export function queryParam(req: IncomingMessage, name: string): string | null {
  try {
    return new URL(req.url ?? "", "http://localhost").searchParams.get(name);
  } catch {
    return null;
  }
}

/** CSRF 校验：header 值非空且等于下发 token（sec-fetch-site 只防浏览器，可伪造）。 */
export function checkCsrf(req: IncomingMessage, token: string, headerName: string): boolean {
  const headerVal = headerValue(req, headerName);
  return headerVal !== "" && headerVal === token;
}

/** readBody 的失败原因：`too-large` 超限（413），`aborted` 流读取中断/坏流（400）。 */
export type BodyRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "too-large" | "aborted" };

/** 请求块 → Buffer（流通常给 Buffer，被 `setEncoding` 改成 string 时按 UTF-8 编码回来）。 */
function chunkToBuffer(chunk: unknown): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
}

/**
 * 读 POST body（**按 UTF-8 字节**计上限；先查 content-length 再收流）。
 *
 * 两个必须一次做对的点：
 *   1. 逐块 `String(chunk)` 会把跨 chunk 边界的多字节字符（中文/emoji）解码成
 *      U+FFFD 且仍是合法 JSON —— 静默写坏用户数据。故累积 Buffer 后一次性解码。
 *   2. 只按解码后字符数设限，恶意 body 可在触顶前已占满内存；content-length
 *      预检让明显超限的请求根本不开始累积。
 * 超限/坏流都立即停止读取（for-await 提前 return 会 release 迭代器并销毁流）。
 */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  // 缺失/分块传输时 headerValue 给空串 → Number('')===0 → 预检不触发，照常流式判定。
  const declared = Number(headerValue(req, "content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: "too-large" };
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const raw of req) {
      const chunk = chunkToBuffer(raw);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        return { ok: false, reason: "too-large" };
      }
      chunks.push(chunk);
    }
  } catch {
    return { ok: false, reason: "aborted" };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

/**
 * 一次性校验组合（通用 POST 端点样板）：跨域拒绝 → CSRF 拒绝 → 读 body →
 * 413（超限）/400（流中断）。全过返回 body 字符串。缺 CSRF 规范（如 GET 或
 * 自持 token 端点）时传 skipCsrf=true。
 */
export async function guardBody(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    maxBytes: number;
    csrf?: { token: string; headerName: string };
  },
): Promise<string | null> {
  if (isCrossOrigin(req)) {
    sendJson(res, 403, { ok: false, error: "cross-origin request rejected" });
    return null;
  }
  if (opts.csrf !== undefined && !checkCsrf(req, opts.csrf.token, opts.csrf.headerName)) {
    sendJson(res, 403, { ok: false, error: "invalid csrf token" });
    return null;
  }
  const read = await readBody(req, opts.maxBytes);
  if (!read.ok) {
    if (read.reason === "too-large") {
      sendJson(res, 413, { ok: false, error: "request body too large" });
      return null;
    }
    sendJson(res, 400, { ok: false, error: "request body unreadable" });
    return null;
  }
  return read.text;
}
