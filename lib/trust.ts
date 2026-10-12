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
// 语义参照官方 `packages/client/connection/src/api-request-trust.ts` 的 `isTrustedApiRequest`
// 与同目录 `loopback-hostname.ts` 的 `isLoopbackHostname`。不能直接引它的真正原因只有一条：
//
//   **谓词本身没有出口。** `@deepseek-ai/dsh-client-connection` 的根入口只转出
//   HostConnectionHandle / OperatorPeer / 那几件 schema，没有转出 isTrustedApiRequest、
//   assertTrustedAuthority、isLoopbackHostname——它们是该包的模块私有件。它的 exports 虽写着
//   `"./src/*"`，files 却只带 lib/index.js、lib/client.js、lib/types/**，src/ 不随包发布，
//   子路径同样取不到。
//
//   （"它住在 client 包里、host 半插件不引 client 包"**不是**理由。那个包的 index.ts 是个
//   host 插件——apply(ctx) 的 JSDoc 写着 "Host plugin context"，它把服务 provide 进宿主 ctx；
//   出货插件 packages/host/open-in-app/src/index.ts:184-191 就是用
//   Reflect.get(ctx, 'connection').requestRejection(req) 当每条路由 handler 的第一句。
//   官方那条路径在本包是**可用**的，见下一段为什么仍不能顶替。）
//
//   真正可达的是 handle 上的 requestRejection() / admit()，但它们把浏览器认证一并叠上：
//   未认证返 401（packages/client/connection/src/rpc-host.ts:104-107）。本模块刻意只管
//   "信任"、不要求"已认证"（本地 CLI 是既有信任面，见下面分歧 1），所以那条 API 也不能
//   直接顶替。trustedHosts 同理存成 private 字段、插件侧读不到（宿主 0.2.1-alpha.2 把它从
//   `webRuntime` 挪到 `webStartup` 服务上，仍是 profile 的配置面）；本模块可用的信号只有
//   `webServer.host` 那枚绑定字面量，判法见 `isNonLoopbackBindHost`。
// 四处刻意分歧，每条都有理由：
//   1. 缺 `Host` 只在**回环对端**放行（官方一律拒）：那层还有 browser-auth，我们没有，
//      而本地 CLI 是既有信任面（`lib/http.ts` 的 `isCrossOrigin` 已把"空头不拦"写成口径）。
//      可达性本机实测：HTTP/1.1 无 Host 由 **node:http 自己回 400**，根本到不了 handler；
//      能带着"无 Host"走到这里的只有 **HTTP/1.0 或裸 socket**（实测 `GET /a HTTP/1.0` 到
//      handler）。所以这一支不是"浏览器可能不发 Host"的兜底，而是本地面的通路；绑
//      非回环网卡字面量时同网段的裸 socket 也能走到 —— README 明写残余风险。
//      另一处实测：重复 Host 头被 Node 折成**首项字符串**（数组形态在生产上不可达，
//      那条判据是给未来/其它运行时留的 fail-closed，不是当前攻击面）。
//   2. `sec-fetch-site` 用**白名单**（只放 `same-origin`/`none`/缺失），不照抄官方的"只拒
//      `cross-site`"：官方那套把本机异端口标成 `same-site` 并放行，本仓不放过（沿用既有语义）。
//   3. 非回环服务面用**本机网卡实际持有的 IP**，不用官方的 `trustedHosts` 配置。
//      **不放 `.local`/`.lan` 之类后缀名**——mDNS 名可被本机任意进程或同网段主机声称并应答
//      127.0.0.1，那样 Host 与 Origin 两条腿会同时被骗过。`@deepseek-ai/dsh-http-proxy` 那份
//      `isLoopbackHost`（packages/util/http-proxy/src/policy.ts:257）也不能拿来替代：它额外接受
//      `::`、`0.0.0.0` 与 `.localhost` 后缀，用在权威判定上是放宽而非收紧。别把它和宿主
//      0.2.1-alpha.2 新出的 `@deepseek-ai/dsh-host-webserver` 同名导出混为一谈——后者管的是
//      **绑定地址**那一侧，`isNonLoopbackBindHost` 与它对齐，不是与这一份。
//   4. `guardTrust` 自带"头未发"检查：`sendJson` 在头已发时静默 no-op，若有人把闸门挪到
//      `await readBody()` 之后，它会静默失败为放行。
//
// 返回 `null` 而不是 `undefined`（三个内部 helper 同此）：本仓 oxlint 开了
// `typescript/consistent-return` 且 `treatUndefinedAsUnspecified: true`，`return undefined`
// 与带值 return 混用即判红；`null` 与 `queryParam` 的既有口径也一致。

import os from "node:os";
import type { ServerResponse } from "node:http";
import { isIPv4, isIPv6 } from "node:net";
import { sendJson, CROSS_ORIGIN_TEXT } from "./http.ts";
import type { HttpRequest } from "./http.ts";

/** 信任判据的结论。除 `trusted` 外都该被拒。 */
export type TrustVerdict = "trusted" | "untrusted-host" | "cross-site" | "bad-origin";

/** `requestTrust` / `guardTrust` 的可选入参。 */
export interface TrustOptions {
  /**
   * 宿主是否绑在非回环地址上——由 `isNonLoopbackBindHost(webServer.host)` 取，**不要**再自己比
   * 字面量。缺省按 false（保守）。
   */
  servingNonLoopback?: boolean;
  /** 注入本机地址面（测试用；缺省取 `os.networkInterfaces()` 的实际值）。 */
  localInterfaceAddresses?: readonly string[];
}

/** 回环主机名的两个字面量（IPv6 在 WHATWG URL 里**带方括号**）。 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "[::1]"]);

/** 唯一允许通过的 `sec-fetch-site` 取值（缺失=非浏览器，走第 1 条分歧的本地面）。 */
const SAME_SITE_ALLOW: ReadonlySet<string> = new Set(["same-origin", "none"]);

/** Host 权威不是本机可信地址时的响应文案。 */
const UNTRUSTED_HOST_TEXT = "untrusted host authority";

/** WHATWG 把 `::0.0.0.1`、`0:0:0:0:0:0:0:1` 这类拼法一律折成这一枚 IPv6 回环规范形。 */
const IPV6_LOOPBACK = "[::1]";

/** 回环段 127/8 的首段（IPv4 字面量按十进制文本认它）。 */
const LOOPBACK_V4_OCTET = "127";

/**
 * IPv4 映射形里 127/8 那一族的规范前缀。WHATWG 把 `::ffff:127.x.y.z` 一律折成 `[::ffff:7f..:..]`，
 * 且那枚高字落在 0x7f00–0x7fff、必写作四位，所以前缀的头两位就锁定了内嵌 IPv4 的首段。
 * 非 127/8 的映射形要么更短（`::ffff:0:1`）要么另起一位（`::ffff:808:808`），都撞不上这个前缀。
 */
const MAPPED_LOOPBACK_PREFIX = "[::ffff:7f";

/**
 * IPv6 绑定字面量是不是回环。`::1` 有多样拼法（`::0.0.0.1`、全展开形），IPv4 映射形写的是十进制
 * 尾段，两样都先交 WHATWG 归一再认——归一之后回环只剩 `IPV6_LOOPBACK` 与
 * `MAPPED_LOOPBACK_PREFIX` 这一枚值和这一个前缀。`%zone` 是接口选择器、不是地址位，归一前先剥。
 *
 * 这里不兜解析失败：`isIPv6` 已闸过语法，实测它接受的字形 WHATWG 全部接得住（含 `%zone` 剥后
 * 的 `::1%25` 这类），所以本函数没有"走不到的分支"要凑覆盖率——那条前提由台架的字形表钉着。
 */
function isLoopbackIPv6(host: string): boolean {
  const canonical = new URL(`http://[${host.split("%", 1).join("")}]`).hostname;
  return canonical === IPV6_LOOPBACK || canonical.startsWith(MAPPED_LOOPBACK_PREFIX);
}

/**
 * 绑定地址的字面量谓词：`webServer.host` → {@link TrustOptions.servingNonLoopback}。
 *
 * 为什么现在要由本包出这个谓词：`@deepseek-ai/dsh-host-webserver` 的 `Config.host` 在宿主
 * 0.2.1-alpha.2 从 `'127.0.0.1' | '0.0.0.0'` 换成**任意本机接口 IP 字面量**，并把通配地址
 * （`0.0.0.0`、`::` 及其映射形）**在载入时拒掉**。于是消费方沿用至今的那行
 * `webServer.host === "0.0.0.0"` 恒为 false——非回环服务面换了形态（一枚真的网卡地址），
 * 判据却还盯着那枚再也绑不上的字面量，局域网访问会被本模块整片拒成 403。
 *
 * 口径与官方 `isLoopbackHost` 对齐（台架见 `test/trust.test.ts`）。一处**刻意**分歧：非字面量
 * （`localhost`、带方括号的 `[::1]`）本函数按 false，官方那侧 `!isLoopbackHost` 得 true。
 * 宿主自身的 config 校验已经拒掉非字面量，那种值到不了这里；万一到了，false 收紧而非放宽
 * 可放行的 Host 权威——这个方向上宁可错杀。
 *
 * @param host - `webServer.host` 的绑定值；读不到（缺字段、空串、非字面量）按只绑回环处理
 * @returns 绑的是非回环接口地址时为 true
 */
export function isNonLoopbackBindHost(host: string | undefined): boolean {
  if (host === undefined) {
    return false;
  }
  if (isIPv4(host)) {
    // `isIPv4` 已经拒掉前导零（`0277.0.0.1` 不是字面量），所以按十进制文本比首段就够，
    // 与下面 `isLoopbackHostname` 对 Host 权威的那条判据同形。
    return host.split(".", 1).join("") !== LOOPBACK_V4_OCTET;
  }
  return isIPv6(host) && !isLoopbackIPv6(host);
}

/** Origin 那条腿的结论（三形共用：沙箱 `null` 源、Origin 解析失败、权威不相等）。 */
const BAD_ORIGIN_VERDICT: TrustVerdict = "bad-origin";

/**
 * 读一个头的**三态**：缺席 / 单值 / 重复（折叠面，判不得）。
 *
 * 为什么必须把「重复」与「缺席」分开：旧实现把长度非 1 的数组折成 `null`，而 `null` 在
 * `origin` 与 `sec-fetch-site` 两处都被读成**缺席**——于是重复头落进「当没带」那条路。
 * 对**攻击者**而言这不构成提权（能把头发重复的客户端也能干脆不发，而缺席本来就放行，
 * 见文件头分歧 1），但它是一条**降级路**：反向代理在转发时补一枚 Origin、或任何让上游
 * 头重复的中间层，都会把一条本该被 `sec-fetch-site: cross-site` / `Origin: 恶意域`
 * 拒掉的请求变成 trusted。基础设施造成的重复不该等价于"客户端没带"。
 *
 * 三态各自的后果：`origin` 重复 → `bad-origin`；`sec-fetch-site` 重复 → `cross-site`；
 * `host` 重复 → `untrusted-host`（这一条旧实现已显式拒，本改动只是把它并入同一套三态）。
 */
type HeaderRead =
  | { readonly kind: "absent" }
  | { readonly kind: "single"; readonly value: string }
  | { readonly kind: "duplicate" };

function readHeader(req: HttpRequest, name: string): HeaderRead {
  const value = req.headers?.[name];
  if (value === undefined) {
    return { kind: "absent" };
  }
  if (Array.isArray(value)) {
    // 单元素数组是 Node 归一后的合法形状（真值就是那枚）；多元素即"重复头"，与缺席不同档。
    // 写成 join() 而不是 value[0]：后者在 noUncheckedIndexedAccess 下要再加一条进不去的分支。
    return value.length === 1 ? { kind: "single", value: value.join("") } : { kind: "duplicate" };
  }
  return { kind: "single", value };
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

/** 回环判定：`localhost` / `[::1]` / IPv4 映射的 127/8 / 127/8 四段纯数字。
 *
 *  映射形那一档是**两侧口径对齐**的必需项：`isLoopbackIPv6`（绑地址那侧）已经把
 *  `::ffff:127.x.y.z` 认作回环，于是 `isNonLoopbackBindHost("::ffff:127.0.0.1")` 交回
 *  false、宿主按"只绑回环"起服务；但浏览器访问该地址时 Host 头是 `[::ffff:7f00:1]:port`
 *  （WHATWG 归一形，见 authorityOf），这一侧旧实现只认 `::1` 与 IPv4 四段，于是**恒判
 *  非回环 → 整片 403**：绑得了、开得了、就是谁也访问不了。只绑回环的服务面自己撞上它。
 *  判据与 isLoopbackIPv6 共用 MAPPED_LOOPBACK_PREFIX，两边不会各自漂移。
 *  （逐条对齐官方 loopback-hostname.ts 的其余四段纯数字判据。） */
function isLoopbackHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(lowered) || lowered.startsWith(MAPPED_LOOPBACK_PREFIX)) {
    return true;
  }
  const parts = lowered.split(".");
  return (
    parts.length === 4 &&
    parts[0] === LOOPBACK_V4_OCTET &&
    parts.every((part) => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
  );
}

/** `os.networkInterfaces()` 的地址面：IPv6 加方括号（与 `URL.hostname` 同形），IPv4 原样。
 *
 *  刻意**每次现读**而不缓存：这一面只在 `servingNonLoopback === true` 时才被问（只绑回环的
 *  部署一次都不会走到），而缓存会把它变成进程级不可观测状态——test/trust-ifaces.test.ts
 *  正是靠「每个用例换一张 os 桩表」钉这条回落支路的，加缓存就得再配一个测试专用重置口，
 *  那是为一个非缺陷的性能取舍往生产面开缝。收益（省一次 getifaddrs）与代价不成比例。 */
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

/** `sec-fetch-site` 白名单：缺席 = 非浏览器面（交 Host/Origin 两条腿判，见分歧 1）；
 *  **重复 = 判不得 = 拒**（与缺席不同档，见 readHeader 的注释）。 */
function siteIsSameOrigin(req: HttpRequest): boolean {
  const read = readHeader(req, "sec-fetch-site");
  if (read.kind === "duplicate") {
    return false;
  }
  return read.kind === "absent" || SAME_SITE_ALLOW.has(read.value);
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
  const read = readHeader(req, "host");
  if (read.kind === "duplicate") {
    return "rejected";
  }
  if (read.kind === "absent") {
    return peerLoopback(req) === false ? "rejected" : null;
  }
  const parsed = authorityOf(read.value);
  if (parsed === null || !isAcceptedAuthority(parsed.hostname, opts)) {
    return "rejected";
  }
  return parsed;
}

/**
 * 一次判据：Host 权威 → sec-fetch-site（白名单）→ Origin 逐字比对。
 * 纯函数、不写响应；写响应的样板在 `guardTrust`。
 */
export function requestTrust(req: HttpRequest, opts: TrustOptions = {}): TrustVerdict {
  const hostUrl = authorityOfFrom(req, opts);
  if (hostUrl === "rejected") {
    return "untrusted-host";
  }
  if (!siteIsSameOrigin(req)) {
    return "cross-site";
  }
  const originRead = readHeader(req, "origin");
  if (originRead.kind === "duplicate") {
    // 重复 ≠ 缺席：缺席放行（非浏览器面），重复则无从判定是哪一个域在说，保守拒。
    return BAD_ORIGIN_VERDICT;
  }
  if (originRead.kind === "absent") {
    return "trusted";
  }
  const origin = originRead.value;
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
  req: HttpRequest,
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
