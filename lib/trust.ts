// lib/trust.ts —— `/_dsh/*` 端点的请求信任判据（Host 权威 + sec-fetch-site + Origin）。
//
// 为什么需要这一层：本仓 6 个包共 22 条 webServer 路由此前**只**看
// `sec-fetch-site`（`lib/http.ts` 的 `isCrossOrigin`）。DNS 重绑定恰好能过那一条：恶意页面把
// 自己的域名解析到 127.0.0.1 后，浏览器**真的**认为这是同源请求，于是 `sec-fetch-site:
// same-origin` 通过、`Origin` 与 `Host` 彼此相等——两条纵深防御同时失效，剩下的只有
// "Host 是不是本机可信权威"这一条主判据。而 5 个包的 CSRF token 正是在 GET 响应里下发的
// （lesson-loop `:632`、dir-prep `:1274`、ocr-review `:923`、session-rescue `:1728`、
// zvec-grep `:857`），读到 token 就能接着发写请求。
//
// 语义参照官方 `packages/client/connection/src/api-request-trust.ts:91-118` 与
// `src/loopback-hostname.ts:12-19`（dev 仓路径；发布件里 `isTrustedApiRequest` 在
// `dsh-client-connection/lib/index.js:205` 有实体但**不在 `:850` 的导出名单**，插件侧 import 不到）。
// 四处刻意分歧，每条都有理由：
//   1. 缺 `Host` 只在**回环对端**放行（官方一律拒）：那层还有 browser-auth，我们没有，
//      而本地 CLI 是既有信任面（`lib/http.ts:32-34` 已把"空头不拦"写成口径）。
//      可达性本机实测（`/tmp/f1probe.mjs`，node v26）：HTTP/1.1 无 Host 由 **node:http 自己
//      回 400**，根本到不了 handler；能带着"无 Host"走到这里的只有 **HTTP/1.0 或裸 socket**
//      （实测 `GET /a HTTP/1.0` 到 handler）。所以这一支不是"浏览器可能不发 Host"的兜底，
//      而是本地面的通路；绑 `0.0.0.0` 时同网段的裸 socket 也能走到 —— README 明写残余风险。
//      另一处实测：重复 Host 头被 Node 折成**首项字符串**（数组形态在生产上不可达，
//      那条判据是给未来/其它运行时留的 fail-closed，不是当前攻击面）。
//   2. `sec-fetch-site` 用**白名单**（只放 `same-origin`/`none`/缺失），不照抄官方的"只拒
//      `cross-site`"：官方那套把本机异端口标成 `same-site` 并放行，本仓不放过（沿用既有语义）。
//   3. 非回环服务面用**本机网卡实际持有的 IP**，不用官方的 `trustedHosts` 配置：插件侧读不到
//      那个配置（`HostConnectionService` 把它存成 private 字段），唯一可用信号是
//      `webServer.host === "0.0.0.0"`。**不放 `.local`/`.lan` 之类后缀名**——mDNS 名可被本机任意
//      进程或同网段主机声称并应答 127.0.0.1，那样 Host 与 Origin 两条腿会同时被骗过。
//   4. `guardTrust` 自带"头未发"检查：`sendJson` 在头已发时静默 no-op，若有人把闸门挪到
//      `await readBody()` 之后，它会静默失败为放行。
//
// 返回 `null` 而不是 `undefined`（三个内部 helper 同此）：本仓 oxlint 开了
// `typescript/consistent-return` 且 `treatUndefinedAsUnspecified: true`，`return undefined`
// 与带值 return 混用即判红；`null` 与 `queryParam` 的既有口径也一致。

import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./http.ts";
import type { HttpRequest } from "./http.ts";

/** 信任判据的结论。除 `trusted` 外都该被拒。 */
export type TrustVerdict = "trusted" | "untrusted-host" | "cross-site" | "bad-origin";

/** `requestTrust` / `guardTrust` 的可选入参。 */
export interface TrustOptions {
  /** 宿主是否绑在非回环地址上（`webServer.host === "0.0.0.0"`）。缺省按 false（保守）。 */
  servingNonLoopback?: boolean;
  /** 注入本机地址面（测试用；缺省取 `os.networkInterfaces()` 的实际值）。 */
  localInterfaceAddresses?: readonly string[];
}

/** 回环主机名的两个字面量（IPv6 在 WHATWG URL 里**带方括号**）。 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/** 唯一允许通过的 `sec-fetch-site` 取值（缺失=非浏览器，走第 1 条分歧的本地面）。 */
const SAME_SITE_ALLOW: ReadonlySet<string> = new Set(["same-origin", "none"]);

/** 站点级拒绝的响应文案（沿用 `lib/http.ts` 既有那句，统一口径时就少改一处断言）。 */
const CROSS_ORIGIN_TEXT = "cross-origin request rejected";

/** Host 权威不是本机可信地址时的响应文案。 */
const UNTRUSTED_HOST_TEXT = "untrusted host authority";

/** Origin 那条腿的结论（三形共用：沙箱 `null` 源、Origin 解析失败、权威不相等）。 */
const BAD_ORIGIN_VERDICT: TrustVerdict = "bad-origin";

/** 两形之外没有第三形（Node 的 IncomingHttpHeaders 值是 `string | string[]`），故不做 typeof 自卫。 */
function singleHeader(req: HttpRequest, name: string): string | null {
  const value = req.headers?.[name];
  if (value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    // 单元素数组是 Node 归一后的合法形状（真值就是那枚），多元素即"重复头"= 折叠面，判不得。
    // 写成 join() 而不是 value[0]：后者在 noUncheckedIndexedAccess 下要再加一条进不去的分支。
    return value.length === 1 ? value.join("") : null;
  }
  return value;
}

/** Host 头的可接受字形。WHATWG 解析会**静默吃掉** tab/CR/LF 并丢掉 `user@` 前缀，
 *  于是 `local\thost:8787` 与 `evil.com@localhost:8787` 都能被折成"回环权威"（本机实测
 *  `new URL("http://" + "local\\thost:8787").hostname === "localhost"`）。浏览器发不出这些，
 *  但这一腿是本仓唯一挡得住 DNS 重绑定的判据 ⇒ 先按字形拒，再交给解析。 */
const HOST_GLYPHS_RE = /^[A-Za-z0-9._\-[\]:%]+$/u;

/** WHATWG 解析一个 authority（`host:port`）；失败返回 null。IPv6 必须已带方括号。 */
function authorityOf(authority: string): URL | null {
  if (!HOST_GLYPHS_RE.test(authority)) {
    return null;
  }
  try {
    return new URL(`http://${authority}`);
  } catch {
    return null;
  }
}

/** 回环判定：`localhost` / `[::1]` / 127/8 四段纯数字（逐条对齐官方 loopback-hostname.ts）。 */
function isLoopbackHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(lowered)) {
    return true;
  }
  const parts = lowered.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
}

/** `os.networkInterfaces()` 的地址面：IPv6 加方括号（与 `URL.hostname` 同形），IPv4 原样。 */
function interfaceAddresses(): string[] {
  const listed: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const { family, address } of infos ?? []) {
      listed.push(family === "IPv6" ? `[${address}]` : address);
    }
  }
  return listed;
}

/** Host 权威是不是本机可信地址：回环恒过；非回环只在**声明了非回环服务面**且该址确属本机网卡时过。 */
function isAcceptedAuthority(hostname: string, opts: TrustOptions): boolean {
  if (isLoopbackHostname(hostname)) {
    return true;
  }
  if (opts.servingNonLoopback !== true) {
    return false;
  }
  return (opts.localInterfaceAddresses ?? interfaceAddresses()).includes(hostname);
}

/** `sec-fetch-site` 白名单（缺失等于非浏览器面，交 Host/Origin 两条腿判）。 */
function siteIsSameOrigin(req: IncomingMessage): boolean {
  const site = singleHeader(req, "sec-fetch-site");
  return site === null || SAME_SITE_ALLOW.has(site);
}

/**
 * 对端是不是回环。拿不到 socket（手搓请求的测试构造点、非 node:http 的适配层）时返回 null，
 * 表示"这一维未知"，交调用侧按只看头部的旧口径处理。
 */
function peerLoopback(req: HttpRequest): boolean | null {
  const raw = req.socket?.remoteAddress;
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  // Node 在 dual-stack 套接口上可能给出 `::ffff:127.0.0.1`（无方括号）或 `[::1]`（带）。
  const bracketless = raw.replaceAll(/^\[|\]$/gu, "");
  const address = bracketless.replace(/^::ffff:/iu, "");
  return isLoopbackHostname(address) || address === "::1";
}

/**
 * Host 腿：返回解析出的权威、`null`（没带 Host 且对端不是可判的非回环），或 `"rejected"`。
 *
 * 缺 Host 只在**非回环对端**时拒——浏览器走不到这条路（HTTP/1.1 强制 Host、HTTP/2 强制
 * `:authority`，且 Host/Origin/Sec-Fetch-* 由同一个 URL 上下文导出），能走到的只有本地裸 socket
 * 与 Node 客户端（Node 确实收无 Host 的请求）。
 */
function authorityOfFrom(req: HttpRequest, opts: TrustOptions): URL | null | "rejected" {
  const rawHost = req.headers?.host;
  if (Array.isArray(rawHost) && rawHost.length !== 1) {
    return "rejected";
  }
  const host = singleHeader(req, "host");
  if (host === null) {
    return peerLoopback(req) === false ? "rejected" : null;
  }
  const parsed = authorityOf(host);
  if (parsed === null || !isAcceptedAuthority(parsed.hostname, opts)) {
    return "rejected";
  }
  return parsed;
}

/**
 * 一次判据：Host 权威 → sec-fetch-site（白名单）→ Origin 逐字比对。
 * 纯函数、不写响应；写响应的样板在 `guardTrust`。
 */
export function requestTrust(req: IncomingMessage, opts: TrustOptions = {}): TrustVerdict {
  const hostUrl = authorityOfFrom(req, opts);
  if (hostUrl === "rejected") {
    return "untrusted-host";
  }
  if (!siteIsSameOrigin(req)) {
    return "cross-site";
  }
  const origin = singleHeader(req, "origin");
  if (origin === null) {
    return "trusted";
  }
  // `null` 是沙箱 iframe / file: 的不透明源；缺 Host（本地面）时无从比对，保守拒。
  if (origin === "null" || hostUrl === null) {
    return BAD_ORIGIN_VERDICT;
  }
  const originUrl = authorityOf(origin.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, ""));
  if (originUrl === null) {
    return BAD_ORIGIN_VERDICT;
  }
  return originUrl.host === hostUrl.host ? "trusted" : BAD_ORIGIN_VERDICT;
}

/** 结论对应的响应文案（cross-site 与 bad-origin 同一句，两者都是"不是本站的浏览器请求"）。 */
export function trustRejectionText(verdict: TrustVerdict): string {
  return verdict === "untrusted-host" ? UNTRUSTED_HOST_TEXT : CROSS_ORIGIN_TEXT;
}

/**
 * handler 体的**第一条语句**该放的东西：非 trusted 即写一次 403 JSON 并返回 false。
 * 返回 false 时调用方必须立即 return，不得继续读 body 或产生副作用。
 */
export function guardTrust(
  req: IncomingMessage,
  res: ServerResponse,
  opts: TrustOptions = {},
): boolean {
  const verdict = requestTrust(req, opts);
  if (verdict === "trusted") {
    return true;
  }
  if (res.headersSent || res.writableEnded) {
    // 静默 no-op 是这个样板唯一可能的失败方式（闸门被挪到别处就成了放行），故出声。
    console.error("[shared/trust] rejecting after headers were sent:", verdict);
    return false;
  }
  sendJson(res, 403, { ok: false, error: trustRejectionText(verdict) });
  return false;
}
