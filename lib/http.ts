// lib/http.ts —— webServer 端点样板（各插件重复实现，已收敛到 shared）。
//
// 收敛来源（逐字同构）：session-rescue / lesson-loop / zvec-grep / ocr-review /
// ctx-observe 的 sendJson / isCrossOrigin / queryParam / readBody / checkCsrf。
// 设计：纯函数、零依赖、只依赖 node 内建类型；CSRF header 名由调用方传入
// （各插件历史 header 名不同，收敛时保持各自语义，不强行统一名）。

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

/**
 * header 读取 helper 接受的请求形状：真 `IncomingMessage` 或只带部分字段的合成片段。
 *
 * Node 把 `headers` / `socket` 都标成必存在，照抄那个形状会让类型面比现实更乐观——运行时
 * 不得不写 `?.` 自卫，而那条自卫又会被类型感知规则判成冗余。所以这里如实声明可缺字段。
 * 仅覆盖**读头**所需的面：要消费请求体的函数（`readBody` / `guardBody`）仍收
 * `IncomingMessage`，因为 `PartialRequest` 不保证可异步迭代。
 */
export interface PartialRequest {
  readonly headers?: IncomingHttpHeaders;
  readonly socket?: { readonly remoteAddress?: string | undefined } | null;
  readonly url?: string | undefined;
}

/** 只读头的 helper 接受的请求：真 `IncomingMessage` 或合成片段。 */
export type HttpRequest = IncomingMessage | PartialRequest;

/** 写 JSON 响应（no-store：端点都是运行时状态，禁缓存防陈旧）。
 * 已发头/已结束则静默跳过：同一响应被写两次会抛 ERR_HTTP_HEADERS_SENT，
 * 而端点多在 async 回调里，抛错变成 unhandled rejection 拖垮共享的 web host。
 *
 * **序列化先于写头**：循环引用与 BigInt 会让 JSON.stringify 抛错。若把它排在 writeHead
 * 之后，头已发出而 end() 永不执行——响应就此挂住，客户端一直等到超时，调用方也再也
 * 改不了状态码。先算出 body 就把这一支变回一个普通的同步异常。 */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

/**
 * 读单值请求头：重复头取首项，非字符串/无 headers 面（部分 mock）归空串。
 *
 * 取头名先折小写：Node 的 `IncomingHttpHeaders` 键一律小写，而 `checkCsrf` 的头名由**调用方**
 * 传入（本包刻意不统一各插件的历史头名）。调用方按 HTTP 规范写 `X-Csrf-Token` 时，直查会永远
 * 落空——那不是"这条请求没带 token"，而是"这个端点从此 100% 403"，且失败现场离病因很远
 * （实测：同一份 headers，只因传入头名的大小写不同，结果从 true 翻成 false）。
 * 折小写只动**取键**，不碰比对：token 值仍逐字相等，判定强度不变，方向只从"误拒"挪向"照常判"。
 */
function headerValue(req: HttpRequest, name: string): string {
  const value = req.headers?.[name.toLowerCase()];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : "";
}

/**
 * CORS 同源纵深防御：浏览器请求带 sec-fetch-site，非 same-origin/none 即拒绝。
 * 空头（curl/CLI）不拦——浏览器侧伪造不了同源判定，CLI 是本地可信调用面。
 */
export function isCrossOrigin(req: HttpRequest): boolean {
  const site = headerValue(req, "sec-fetch-site");
  return site !== "" && site !== "same-origin" && site !== "none";
}

/** 从 req.url 读 query 参数（URLSearchParams 语义：+ 解码空格、尊重 ; 分隔等）。 */
export function queryParam(req: HttpRequest, name: string): string | null {
  try {
    return new URL(req.url ?? "", "http://localhost").searchParams.get(name);
  } catch {
    return null;
  }
}

/** CSRF 校验：header 值非空且等于下发 token（sec-fetch-site 只防浏览器，可伪造）。 */
export function checkCsrf(req: HttpRequest, token: string, headerName: string): boolean {
  const headerVal = headerValue(req, headerName);
  return headerVal !== "" && headerVal === token;
}

/**
 * readBody 的失败原因：`too-large` 超限（413），`aborted` 流读取中断/坏流（400），
 * `bad-budget` 是**调用方传错了 maxBytes**（负数、`NaN`、`Infinity`）——它不是请求的错，
 * 而是端点自己的限额配置坏了，故单列一档而不是伪装成 413。
 */
export type BodyRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "too-large" | "aborted" | "bad-budget" };

/** 读失败的那三支原因（判别联合的负分支，用来把响应档位表钉成穷尽的）。 */
type BodyRejectReason = Extract<BodyRead, { ok: false }>["reason"];

/**
 * 原因 → 响应。表驱动而不是 if 链：新增一档时漏配会在 tsc 阶段就红，而 if 链只会静默
 * 落到兜底那一档——限额配错被当成"请求过大"报出去，就是这种静默错位。
 */
const BODY_REJECTIONS: Readonly<
  Record<BodyRejectReason, { readonly status: number; readonly error: string }>
> = {
  "too-large": { status: 413, error: "request body too large" },
  aborted: { status: 400, error: "request body unreadable" },
  "bad-budget": { status: 500, error: "request body limit misconfigured" },
};

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
 *
 * `maxBytes` 必须是有限非负数。负数、`NaN`、`Infinity` 一律拒读而不是"当作没有限额"：
 * 任何数与 `NaN` 比较都是 false，所以 `bytes > NaN` 永不成立——一条坏预算会退化成
 * 完全不设限，把本模块存在的理由（防超长输出占满内存）整个绕掉。
 * 上限为 `0` 是合法配置，语义是"只收空 body"。
 */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: "bad-budget" };
  }
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
 * 浏览器来源不合法时的统一文案。导出是因为 `trust.ts` 的浏览器腿要给同一句话：
 * 两处各写一份字面量，改一边就会出现"同一拒绝、两种文案"，而消费方会照文案做断言。
 */
export const CROSS_ORIGIN_TEXT = "cross-origin request rejected";

/**
 * 一次性校验组合（通用 POST 端点样板）：跨域拒绝 → CSRF 拒绝 → 读 body →
 * 413（超限）/400（流中断）/500（限额配置坏了）。全过返回 body 字符串。
 * 缺 CSRF 规范的端点（GET、或自持 token 的端点）**省略 `csrf` 字段**即可——本函数没有
 * `skipCsrf` 参数，旧注释写过，那是在描述一个并不存在的开关。
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
    sendJson(res, 403, { ok: false, error: CROSS_ORIGIN_TEXT });
    return null;
  }
  if (opts.csrf !== undefined && !checkCsrf(req, opts.csrf.token, opts.csrf.headerName)) {
    sendJson(res, 403, { ok: false, error: "invalid csrf token" });
    return null;
  }
  const read = await readBody(req, opts.maxBytes);
  if (read.ok) {
    return read.text;
  }
  // bad-budget 回 500 而不是 400：那是本端点的配置缺陷，叫客户端重发没有意义，
  // 而把它报成"请求体过大"会把排查方向从"自己传错了 maxBytes"整个带走。
  const rejection = BODY_REJECTIONS[read.reason];
  sendJson(res, rejection.status, { ok: false, error: rejection.error });
  return null;
}
