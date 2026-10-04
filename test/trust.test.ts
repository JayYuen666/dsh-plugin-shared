// test/trust.test.ts —— 请求信任判据的分支面。
//
// 判据的每一项都要有用例，因为它的失败模式是**静默放行**（不是报错）：
// 尤其 DNS 重绑定那一形，`sec-fetch-site` 与 `Origin` 两条都会**通过**，只有 Host 那条拒它，
// 所以既要有"只有 Host 腿在跑才可能红"的正例，也要有钉判据次序的对照。
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requestTrust, guardTrust, trustRejectionText } from "../lib/trust.ts";
import { logged, loggedText } from "./setup-logs.ts";

/** 手搓一个 IncomingMessage 形状（与 test/http.test.ts 同一口径：默认 headers 为空对象）。 */
function fakeReq(overrides: Record<string, unknown> = {}): IncomingMessage {
  return { headers: {}, url: "/", ...overrides } as unknown as IncomingMessage;
}

/** 只收一次写盘的假响应（能观察到"写了几次"与状态码/体）。 */
function fakeRes(overrides: Record<string, unknown> = {}): {
  res: ServerResponse;
  writes: { status?: number; body?: unknown }[];
} {
  const writes: { status?: number; body?: unknown }[] = [];
  const res = {
    headersSent: false,
    writableEnded: false,
    writeHead(status: number, headers: Record<string, string>): void {
      writes.push({ status, body: headers });
      res.headersSent = true;
    },
    end(body?: string): void {
      writes.push({ body });
      res.writableEnded = true;
    },
    ...overrides,
  };
  return { res: res as unknown as ServerResponse, writes };
}

// ── 用例里反复出现的字形（测试侧各自独立一份字面量，不去取 lib/trust.ts 的私有常量：
//    断言必须与被测实现无关，改了实现里的常量名/取值就该红在这里）──

/** 可放行的回环 Host 权威（本机服务面的默认端口）。 */
const LOCALHOST_AUTHORITY = "localhost:8787";

/** 回环的 IPv4 写法（本机服务面的默认端口）；与上者成对，字面量各写一次。 */
const IPV4_AUTHORITY = "127.0.0.1:8787";

/** 手搓一条只带 Host 的请求（把 `requestTrust(fakeReq({…}))` 那三层嵌套收进一处，
 *  下面的表驱动才读得动；放在模块级是因为它不捕获任何作用域变量）。 */
const verdictForHost = (host: string): string => requestTrust(fakeReq({ headers: { host } }));

/** DNS 重绑定攻击者的权威：socket 落在回环，Host 却是外域。 */
const ATTACKER_AUTHORITY = "evil.test:8787";

/** Host 腿的结论。 */
const VERDICT_UNTRUSTED_HOST = "untrusted-host";

/** 浏览器腿的结论，同时也是 `sec-fetch-site` 的那个声明取值。 */
const VERDICT_CROSS_SITE = "cross-site";

/** Origin 腿的结论。 */
const VERDICT_BAD_ORIGIN = "bad-origin";

/** `sec-fetch-site` 白名单里的同源声明。 */
const FETCH_SITE_SAME_ORIGIN = "same-origin";

/** 浏览器腿（cross-site 与 bad-origin 共用）的响应文案。 */
const BROWSER_REJECTION_TEXT = "cross-origin request rejected";

describe("requestTrust：Host 权威腿", () => {
  it("回环三种写法都认：localhost、127/8、带方括号的 ::1", () => {
    for (const host of [LOCALHOST_AUTHORITY, IPV4_AUTHORITY, "[::1]:8787", "LOCALHOST:8787"]) {
      assert.equal(requestTrust(fakeReq({ headers: { host } })), "trusted", `${host} 应放行`);
    }
  });

  it("非回环域名一律拒（DNS 重绑定的主判据就在这条腿上）", () => {
    assert.equal(
      requestTrust(fakeReq({ headers: { host: ATTACKER_AUTHORITY } })),
      VERDICT_UNTRUSTED_HOST,
    );
    // 前缀欺骗：`localhost.evil.test` 不是 localhost（比较走 URL.hostname，不是 startsWith）。
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "localhost.evil.test:8787" } })),
      VERDICT_UNTRUSTED_HOST,
    );
    // 127/8 必须是四段纯数字：`127.evil.test` 这种主机名不许蒙过去。
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "127.evil.test" } })),
      VERDICT_UNTRUSTED_HOST,
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "127.0.0.256" } })),
      VERDICT_UNTRUSTED_HOST,
    );
  });

  it("不可解析的 Host 直接拒，不猜", () => {
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "not a host" } })),
      VERDICT_UNTRUSTED_HOST,
    );
    assert.equal(requestTrust(fakeReq({ headers: { host: "" } })), VERDICT_UNTRUSTED_HOST);
    // 字形闸（复核给的实测）：WHATWG 会**静默吃掉** tab 并丢掉 `user@` 前缀，
    // 于是下面两形都能被折成"回环权威"——浏览器发不出，但这一腿是主防御，不许靠运气。
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "local\thost:8787" } })),
      VERDICT_UNTRUSTED_HOST,
      "tab 混进 localhost 不得算回环",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "evil.test@localhost:8787" } })),
      VERDICT_UNTRUSTED_HOST,
      "userinfo 前缀不得被丢进回环",
    );
  });

  it("重复 Host 头（数组）拒：取值面被折叠过，任何一侧的解释都可能是攻击者的", () => {
    assert.equal(
      requestTrust(fakeReq({ headers: { host: [LOCALHOST_AUTHORITY, ATTACKER_AUTHORITY] } })),
      VERDICT_UNTRUSTED_HOST,
    );
    // 单元素数组是 Node 归一后的合法形状，按那一枚判。
    assert.equal(requestTrust(fakeReq({ headers: { host: [LOCALHOST_AUTHORITY] } })), "trusted");
  });

  it("缺 Host：回环对端放行、非回环对端拒、无 socket 面退回只看头", () => {
    // 浏览器走不到这条路（HTTP/1.1 强制 Host、HTTP/2 强制 :authority），能走到的只有本地裸 socket。
    assert.equal(
      requestTrust(fakeReq({ headers: {}, socket: { remoteAddress: "127.0.0.1" } })),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: {}, socket: { remoteAddress: "::1" } })),
      "trusted",
      "IPv6 回环字面量",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: {}, socket: { remoteAddress: "[::ffff:127.0.0.1]" } })),
      "trusted",
      "v4-mapped 形态要先剥封装再比",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: {}, socket: { remoteAddress: "10.0.0.7" } })),
      VERDICT_UNTRUSTED_HOST,
      "非回环对端不给缺 Host 的直通",
    );
    assert.equal(requestTrust(fakeReq({ headers: {} })), "trusted", "无 socket 面（手搓构造点）");
    assert.equal(
      requestTrust(fakeReq({ headers: {}, socket: { remoteAddress: "" } })),
      "trusted",
      "空地址等于未知，不按非回环处理",
    );
  });

  it("绑 0.0.0.0 时才放本机网卡实际持有的地址；不放后缀名", () => {
    const local = ["192.168.1.5", "10.0.0.7", "[fd00::1234]"];
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "192.168.1.5:8787" } }), {
        servingNonLoopback: true,
        localInterfaceAddresses: local,
      }),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "[fd00::1234]:8787" } }), {
        servingNonLoopback: true,
        localInterfaceAddresses: local,
      }),
      "trusted",
      "IPv6 唯一局部址要能与带方括号的形态对上",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "192.168.1.5:8787" } }), {
        localInterfaceAddresses: local,
      }),
      VERDICT_UNTRUSTED_HOST,
      "没声明非回环服务面时，私网地址也拒（保守档）",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "evil.local:8787" } }), {
        servingNonLoopback: true,
        localInterfaceAddresses: local,
      }),
      VERDICT_UNTRUSTED_HOST,
      "mDNS/`.local` 这类可被本机任意进程声称、也能应答 127.0.0.1 的名字**不**在白名单里",
    );
  });

  it("不注入地址面时回落到实装网卡表：非本机地址仍拒，本机持有的地址仍过", async () => {
    // 这一条钉的是 `opts.localInterfaceAddresses ?? interfaceAddresses()` 的缺省支路——
    // 全部用例都注入的话，那条回落支路一次没跑过，"本机装得上、别人装不上"就没人报。
    const os = await import("node:os");
    const listed: string[] = [];
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        listed.push(info.family === "IPv6" ? `[${info.address}]` : info.address);
      }
    }
    const nonLoopback = listed.find(
      (entry) => !/^(?:127\.|\[?::1\]?$)/u.test(entry) && !entry.startsWith("[fe80"),
    );
    if (nonLoopback === undefined) {
      // 纯回环环境（CI 常见）：只验"外域一定拒"，它不依赖本机表。
      assert.equal(
        requestTrust(fakeReq({ headers: { host: "203.0.113.9:8787" } }), {
          servingNonLoopback: true,
        }),
        VERDICT_UNTRUSTED_HOST,
      );
      return;
    }
    assert.equal(
      requestTrust(fakeReq({ headers: { host: `${nonLoopback}:8787` } }), {
        servingNonLoopback: true,
      }),
      "trusted",
      `${nonLoopback} 是本机网卡持有的地址`,
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "203.0.113.9:8787" } }), {
        servingNonLoopback: true,
      }),
      VERDICT_UNTRUSTED_HOST,
    );
  });
});

describe("requestTrust：sec-fetch-site 与 Origin", () => {
  it("白名单：只放 same-origin / none / 缺失，same-site（本机异端口）拒", () => {
    const base = { host: LOCALHOST_AUTHORITY };
    assert.equal(
      requestTrust(fakeReq({ headers: { ...base, "sec-fetch-site": FETCH_SITE_SAME_ORIGIN } })),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { ...base, "sec-fetch-site": "none" } })),
      "trusted",
    );
    assert.equal(requestTrust(fakeReq({ headers: base })), "trusted", "空头 = 非浏览器本地面");
    assert.equal(
      requestTrust(fakeReq({ headers: { ...base, "sec-fetch-site": VERDICT_CROSS_SITE } })),
      VERDICT_CROSS_SITE,
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { ...base, "sec-fetch-site": "same-site" } })),
      VERDICT_CROSS_SITE,
    );
  });

  it("origin 存在时必须逐字等于 Host 权威（含端口），`:80` 冗余端口与大小写不改变结论", () => {
    assert.equal(
      requestTrust(
        fakeReq({ headers: { host: LOCALHOST_AUTHORITY, origin: "http://localhost:8787" } }),
      ),
      "trusted",
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: "localhost", origin: "http://localhost:80" } })),
      "trusted",
      "WHATWG 会剥掉默认端口，两边都归一到同一权威",
    );
    assert.equal(
      requestTrust(
        fakeReq({ headers: { host: LOCALHOST_AUTHORITY, origin: "http://localhost:5173" } }),
      ),
      VERDICT_BAD_ORIGIN,
      "异端口（同源判定不吃端口）",
    );
    assert.equal(
      requestTrust(
        fakeReq({ headers: { host: LOCALHOST_AUTHORITY, origin: "https://evil.test" } }),
      ),
      VERDICT_BAD_ORIGIN,
    );
  });

  it("origin 的 `null`（沙箱 iframe / file:）与坏形一律拒", () => {
    assert.equal(
      requestTrust(fakeReq({ headers: { host: LOCALHOST_AUTHORITY, origin: "null" } })),
      VERDICT_BAD_ORIGIN,
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { host: LOCALHOST_AUTHORITY, origin: "not a url" } })),
      VERDICT_BAD_ORIGIN,
    );
    assert.equal(
      requestTrust(fakeReq({ headers: { origin: "http://localhost:8787" } })),
      VERDICT_BAD_ORIGIN,
      "缺 Host 时无从比对",
    );
  });

  it("重复的 sec-fetch-site / Origin 头同样落进「取值面被折叠」那条判据", () => {
    assert.equal(
      requestTrust(
        fakeReq({
          headers: {
            host: LOCALHOST_AUTHORITY,
            "sec-fetch-site": [FETCH_SITE_SAME_ORIGIN, "none"],
          },
        }),
      ),
      "trusted",
      "数组长度非 1 时按缺失处理：这两条头不是信任**来源**，缺了只会退回 Host 腿",
    );
    assert.equal(
      requestTrust(
        fakeReq({
          headers: { host: LOCALHOST_AUTHORITY, origin: ["http://evil.test", "http://a"] },
        }),
      ),
      "trusted",
      "同上：Origin 折叠掉等于不带，Host 腿仍在拒可疑权威",
    );
  });
});

describe("trustRejectionText 与 guardTrust", () => {
  it("文案：Host 腿一句、浏览器腿一句（后者沿用既有那句 cross-origin request rejected）", () => {
    assert.equal(trustRejectionText(VERDICT_UNTRUSTED_HOST), "untrusted host authority");
    assert.equal(trustRejectionText(VERDICT_CROSS_SITE), BROWSER_REJECTION_TEXT);
    assert.equal(trustRejectionText(VERDICT_BAD_ORIGIN), BROWSER_REJECTION_TEXT);
    assert.equal(trustRejectionText("trusted"), BROWSER_REJECTION_TEXT);
  });

  it("guardTrust：放行时不写任何东西，拒绝时恰好写一次 403 JSON", () => {
    const ok = fakeRes();
    assert.equal(guardTrust(fakeReq({ headers: { host: LOCALHOST_AUTHORITY } }), ok.res), true);
    assert.equal(ok.writes.length, 0, "放行不许碰响应——否则 handler 后面的正常写入就撞头");

    const bad = fakeRes();
    assert.equal(guardTrust(fakeReq({ headers: { host: ATTACKER_AUTHORITY } }), bad.res), false);
    assert.equal(bad.writes.length, 2, "writeHead + end 各一次，且只这一轮");
    assert.deepEqual(bad.writes[0], {
      status: 403,
      body: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
    assert.deepEqual(bad.writes[1], { body: '{"ok":false,"error":"untrusted host authority"}' });
  });

  it("头已发时不许静默失败为放行（sendJson 会 no-op，所以这里必须返回 false 并出声）", () => {
    const { res, writes } = fakeRes({ headersSent: true });
    // console 由 test/setup-logs.ts 的账本接管，所以这里直接读账本：既不用自己装 spy、
    // 也不会把那行日志喷进报告（它带一整条栈，正是噪点的来源）。
    assert.equal(guardTrust(fakeReq({ headers: { host: ATTACKER_AUTHORITY } }), res), false);
    assert.equal(writes.length, 0, "已经发头就不再二次写响应");
    const records = logged();
    // 断言写成「整张表映射后逐字比」，不取下标：本仓开了 noUncheckedIndexedAccess，
    // `records[0]` 在 tsc 眼里是 LogRecord | undefined，而 lint 的类型面又把它当成非空
    // （于是判我多写了 ?.）。两种写法各红一条，只有整表映射对两者都干净——顺带把
    // 「恰好一条」也编进期望值里：少一条时映射出 []，同样不等于 ["error"]。
    assert.deepEqual(
      records.map((record) => record.level),
      ["error"],
      "必须出声一次：静默 no-op 是这条样板唯一的失败方式",
    );
    assert.match(loggedText(), /rejecting after headers were sent/u);
    // 第二个实参是那条 verdict（不在拼平的首参里）。
    assert.deepEqual(
      records.map((record) => record.extra[0]),
      [VERDICT_UNTRUSTED_HOST],
    );
  });
});

describe("真 node:http 回环集成（171 个手搓构造点之外唯一的头/对端事实来源）", () => {
  it("重绑定必须用 node:http 造：fetch 会把 host 头按 URL 改写，Host 腿根本测不到", async () => {
    const seen: string[] = [];
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      seen.push(`${String(req.headers.host)}|${String(req.socket.remoteAddress)}`);
      if (requestTrust(req) !== "trusted") {
        guardTrust(req, res);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    /** 走真实套接口发一枚请求，把状态码与响应体并成一串好比对。 */
    const send = async (headers: Record<string, string>): Promise<string> => {
      const req = request({ host: "127.0.0.1", port, path: "/_dsh/probe", headers });
      req.end();
      const [res] = (await once(req, "response")) as [IncomingMessage];
      const chunks: Buffer[] = [];
      for await (const chunk of res) {
        chunks.push(chunk as Buffer);
      }
      return `${String(res.statusCode)} ${Buffer.concat(chunks).toString("utf8")}`;
    };
    try {
      assert.match(await send({ host: `127.0.0.1:${String(port)}` }), /^200 /u);

      // 重绑定的真实形状：socket 落在 127.0.0.1，而 Host 是攻击者的域（浏览器就是这么发的），
      // sec-fetch-site 与 Origin 都自洽 ⇒ 只有 Host 腿拒得了它。
      const rebound = await send({
        host: ATTACKER_AUTHORITY,
        origin: "http://evil.test:8787",
        "sec-fetch-site": FETCH_SITE_SAME_ORIGIN,
      });
      assert.match(rebound, /^403 /u);
      assert.match(rebound, /untrusted host authority/u);

      // 本机另一个端口的页面（same-site）：白名单档拒，不靠 Origin 比对兜。
      const sameSite = await send({
        host: `127.0.0.1:${String(port)}`,
        origin: "http://127.0.0.1:5173",
        "sec-fetch-site": "same-site",
      });
      assert.match(sameSite, /^403 /u);
      assert.match(sameSite, /cross-origin request rejected/u);
    } finally {
      server.close();
      await once(server, "close");
    }
    assert.equal(seen.length, 3, "三次请求都到了 handler");
    // noUncheckedIndexedAccess 下 seen[i] 是 string | undefined，兜空串而不是非空断言：
    // 真缺项时上面那条 length 断言已经先红，这里只是让类型过。
    assert.match(seen[0] ?? "", /^127\.0\.0\.1:\d+\|/u, "Node 原样给出我们发的 Host，对端是回环");
    assert.match(
      seen[1] ?? "",
      /^evil\.test:8787\|/u,
      "伪造的 Host 头真的到了服务端（否则这条针是空的）",
    );
  });
});

describe("host 字形面：WHATWG 会静默改写的输入一律先按字形拒", () => {
  /** Host 腿的放行结论（与 VERDICT_UNTRUSTED_HOST 成对，别散着写字面量）。 */
  const VERDICT_TRUSTED = "trusted";

  it("userinfo / 编码点 / 尾点 / 空白 / CRLF / 片段 这些绕过写法全部落进 untrusted-host", () => {
    // 判据是 HOST_GLYPHS_RE + 解析结果两条一起。文件头点名的两个真实绕过：
    //   local\thost:8787  → new URL(...).hostname === "localhost"（tab 被静默吃掉）
    //   evil.com@localhost:8787 → 同样折成 "localhost"（user@ 前缀被静默丢掉）
    // 前者已有用例钉着，后者以及下面其余几类此前只有注释、没有用例——注释里的断言
    // 必须有对应的红得起来的测试，否则有人把 HOST_GLYPHS_RE 放宽时不会有任何测试报警。
    const hostileHosts = [
      // userinfo 前缀：与 local\thost 同类的静默改写。
      "evil.com@localhost:8787",
      // 片段里再塞一枚 userinfo，绕过点在 URL 解析的更后面。
      "127.0.0.1:8787#@evil.test",
      // 百分号编码的点：WHATWG 不会把它还原成句点，但也不该由解析器去猜。
      "localhost%2e:8787",
      // 尾点（FQDN 根写法）：hostname 是 "localhost."，与回环字面量差一字符。
      "localhost.:8787",
      // IPv6 前缀拼接。
      "[::1]evil.test",
      // 端口写成十六进制 / 越界。
      "localhost:0x1f",
      "localhost:99999999",
      // 首尾空白与串内空白（端口换 9999，免得整串里嵌进 LOCALHOST_AUTHORITY 那个字面量，
      // 被 sonarjs 的重复字面量规则按子串算重）。
      "localhost:9999 ",
      " localhost:9999",
      "local host:9999",
      // CRLF 头注入与尾随 tab：解析器会静默吃掉，正是先按字形拒的理由。
      "localhost:9999\r\nX-Injected: 1",
      "127.0.0.1:9999\t",
    ];
    for (const host of hostileHosts) {
      assert.equal(verdictForHost(host), VERDICT_UNTRUSTED_HOST, `${host} 不得被当成回环权威`);
    }
  });

  it("八位组与带方括号的回环写法仍然放行（字形收紧不得误伤真权威）", () => {
    // 与上一条互为反面：判据放宽到"什么都交给 WHATWG"或收紧过头都会在这里露馅。
    const loopbackAuthorities = [
      LOCALHOST_AUTHORITY,
      // 大写：authority 判定走 URL.hostname（WHATWG 解析会自己折小写）。
      "LOCALHOST:8787",
      IPV4_AUTHORITY,
      // WHATWG 的 IPv4 缩写写法，解析后仍是 127.0.0.1。
      "127.1:8787",
      // 127/8 整段都是回环。
      "127.255.255.255:8787",
      "[::1]:8787",
      // 无端口（默认 80）。
      "localhost",
    ];
    for (const host of loopbackAuthorities) {
      assert.equal(verdictForHost(host), VERDICT_TRUSTED, `${host} 应放行`);
    }
    // 反面三枚：0.0.0.0 不是回环、非法八位组解析不出来、八进制 0277 折成 191.0.0.1。
    for (const host of ["0.0.0.0:8787", "127.0.0.256:8787", "0277.0.0.1:8787"]) {
      assert.equal(verdictForHost(host), VERDICT_UNTRUSTED_HOST, `${host} 不得放行`);
    }
  });
});
