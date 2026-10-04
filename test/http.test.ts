// test/http.test.ts —— HTTP 样板单测（sendJson/isCrossOrigin/queryParam/checkCsrf/readBody/guardBody）。

import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  sendJson,
  isCrossOrigin,
  queryParam,
  checkCsrf,
  readBody,
  guardBody,
} from "../lib/http.ts";

interface ResShape {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  headersSent: boolean;
  writableEnded: boolean;
  writeHead: (status: number, headers: Record<string, unknown>) => void;
  end: (body: string) => void;
}

function fakeRes(): ResShape & ServerResponse {
  // 只验证 writeHead/end 累积结果，不真发网络。headersSent/writableEnded 跟随
  // 真实 ServerResponse 的语义置位，才能覆盖 sendJson 的重复写保护。
  const res: ResShape = {
    status: 0,
    headers: {},
    body: "",
    headersSent: false,
    writableEnded: false,
    writeHead(status: number, headers: Record<string, unknown>): void {
      this.status = status;
      this.headers = headers as Record<string, string | string[] | undefined>;
      this.headersSent = true;
    },
    end(body: string): void {
      this.body = body;
      this.writableEnded = true;
    },
  };
  return res as unknown as ResShape & ServerResponse;
}

function fakeReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return { headers: {}, url: "/", ...overrides } as unknown as IncomingMessage;
}

function bodyStream(text: string): IncomingMessage {
  return Readable.from([text]) as unknown as IncomingMessage;
}

/** 带 body 流且可附加 header 的请求（CSRF + body 组合场景）。 */
function fakeReqWithBody(text: string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([text]) as unknown as IncomingMessage & {
    headers: Record<string, string>;
  };
  stream.headers = headers;
  return stream;
}

describe("sendJson", () => {
  it("写 JSON + no-store 头", () => {
    const res = fakeRes();
    sendJson(res, 200, { ok: true, count: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true,"count":1}');
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("重复写同一响应静默跳过（不发第二份头 → 不抛 ERR_HTTP_HEADERS_SENT）", () => {
    const res = fakeRes();
    sendJson(res, 200, { ok: true });
    expect(() => {
      sendJson(res, 500, { ok: false, error: "late failure" });
    }).not.toThrow();
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("只结束未发头时也跳过", () => {
    const res = fakeRes();
    res.writableEnded = true;
    sendJson(res, 200, { ok: true });
    expect(res.status).toBe(0);
  });

  it("payload 序列化失败时**不写头**：头已发而 end() 永不执行会把响应永久挂住", () => {
    const res = fakeRes();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    // 异常必须冒出来（调用方据此改走自己的降级），但此时响应仍是可写的
    expect(() => {
      sendJson(res, 200, circular);
    }).toThrow(TypeError);
    expect(res.headersSent, "写头发生在序列化之前就会挂死连接").toBe(false);
    expect(res.status).toBe(0);
    // BigInt 同理
    expect(() => {
      sendJson(res, 200, { big: 1n });
    }).toThrow(TypeError);
    expect(res.headersSent).toBe(false);
  });
});

/** sec-fetch-site 的拒绝取值之一（"cross-site" 字面量在标题里也出现过，别散着写）。 */
const CROSS_SITE = "cross-site";

describe("isCrossOrigin", () => {
  it("空头放行（CLI/curl 本地调用面）", () => {
    expect(isCrossOrigin(fakeReq())).toBe(false);
  });

  it("same-origin / none 放行", () => {
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "same-origin" } }))).toBe(false);
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "none" } }))).toBe(false);
  });

  it("cross-site 拒绝", () => {
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": CROSS_SITE } }))).toBe(true);
    expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": "https://evil.example" } }))).toBe(
      true,
    );
  });
});

describe("queryParam", () => {
  it("读取 + 解码（+ 转空格）", () => {
    expect(queryParam(fakeReq({ url: "/x?a=b+c&d=%E4%B8%AD" }), "a")).toBe("b c");
    expect(queryParam(fakeReq({ url: "/x?a=b+c&d=%E4%B8%AD" }), "d")).toBe("中");
    expect(queryParam(fakeReq({ url: "/x?a=b" }), "missing")).toBeNull();
  });

  it("非法 url 返回 null", () => {
    expect(queryParam(fakeReq({ url: "http://[" }), "a")).toBeNull();
  });

  it("url 缺失（undefined/空串）按空路径解析，参数取不到但不抛", () => {
    expect(queryParam(fakeReq({ url: undefined }), "a")).toBeNull();
    expect(queryParam(fakeReq({ url: "/x?a=b" }), "a")).toBe("b");
  });
});

describe("checkCsrf", () => {
  it("header 命中且非空通过；不匹配/缺失拒绝", () => {
    const token = "t-123";
    expect(checkCsrf(fakeReq({ headers: { "x-test": token } }), token, "x-test")).toBe(true);
    expect(checkCsrf(fakeReq({ headers: { "x-test": "wrong" } }), token, "x-test")).toBe(false);
    expect(checkCsrf(fakeReq(), token, "x-test")).toBe(false);
    expect(checkCsrf(fakeReq({ headers: { "x-test": "" } }), token, "x-test")).toBe(false);
  });

  it("数组 header 取首项", () => {
    const token = "t-1";
    expect(checkCsrf(fakeReq({ headers: { "x-test": ["bad", token] } }), token, "x-test")).toBe(
      false,
    );
    expect(checkCsrf(fakeReq({ headers: { "x-test": [token] } }), token, "x-test")).toBe(true);
  });
});

describe("readBody", () => {
  it("完整读回字符串块（超限/中断各自回报原因）", async () => {
    await expect(readBody(bodyStream("hello"), 100)).resolves.toStrictEqual({
      ok: true,
      text: "hello",
    });
    await expect(readBody(bodyStream("hello"), 4)).resolves.toStrictEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("多字节字符跨 chunk 边界不被解码成 U+FFFD", async () => {
    // 逐块 String(chunk) 的回归：中文按 UTF-8 占 3 字节，chunk 落在字符中间时
    // 会得到替换字符且仍是合法 JSON —— 静默写坏用户数据。
    const buf = Buffer.from('{"k":"中文整理测试"}', "utf8");
    const cutPoints: number[] = [];
    for (let cut = 1; cut < buf.length; cut += 1) {
      cutPoints.push(cut);
    }
    const reads = await Promise.all(
      cutPoints.map(async (cut) => {
        const stream = Readable.from([buf.subarray(0, cut), buf.subarray(cut)]);
        return readBody(stream as unknown as IncomingMessage, 1_000_000);
      }),
    );
    const wanted = { ok: true, text: buf.toString("utf8") };
    expect(reads).toStrictEqual(cutPoints.map(() => wanted));
  });

  it("Buffer 块与 string 块混排一致", async () => {
    const mixed = Readable.from([Buffer.from("a中"), "b", Buffer.from("c")]);
    await expect(readBody(mixed as unknown as IncomingMessage, 100)).resolves.toStrictEqual({
      ok: true,
      text: "a中bc",
    });
  });

  it("content-length 超限时不读流（大 body 不占内存）", async () => {
    let pulled = false;
    const src = new Readable({
      read(): void {
        pulled = true;
        this.push("x".repeat(10));
        this.push(null);
      },
    });
    const req = Object.assign(src, {
      headers: { "content-length": "999999" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 10)).resolves.toStrictEqual({ ok: false, reason: "too-large" });
    expect(pulled).toBe(false);
  });

  it("content-length 合法时照常读取", async () => {
    const req = Object.assign(Readable.from(["ok"]), {
      headers: { "content-length": "2" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 10)).resolves.toStrictEqual({ ok: true, text: "ok" });
  });

  it("content-length 非数字（分块传输）不参与判定", async () => {
    const req = Object.assign(Readable.from(["chunked"]), {
      headers: { "content-length": "abc" },
    }) as unknown as IncomingMessage;
    await expect(readBody(req, 100)).resolves.toStrictEqual({ ok: true, text: "chunked" });
  });

  it("流错误返回 aborted（不抛）", async () => {
    const errStream = new Readable({
      read(): void {
        this.destroy(new Error("boom"));
      },
    }) as unknown as IncomingMessage;
    await expect(readBody(errStream, 100)).resolves.toStrictEqual({ ok: false, reason: "aborted" });
  });

  it("坏预算一律拒读，不退化成不限额", async () => {
    // 任何数与 NaN 比较都是 false，`bytes > NaN` 永不成立——不拦就等于整条限额形同不存在，
    // 而本模块存在的理由正是那条限额。
    const budgets = [Number.NaN, Number.POSITIVE_INFINITY, -1];
    const results = await Promise.all(
      budgets.map(async (budget) => readBody(bodyStream("hello"), budget)),
    );
    for (const result of results) {
      expect(result).toStrictEqual({ ok: false, reason: "bad-budget" });
    }
  });

  it("预算为 0 是合法配置（只收空 body），不算坏预算", async () => {
    await expect(readBody(bodyStream(""), 0)).resolves.toStrictEqual({ ok: true, text: "" });
    await expect(readBody(bodyStream("x"), 0)).resolves.toStrictEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("坏预算不碰流：限额配置坏了就没有必要把请求体读进内存", async () => {
    let pulled = 0;
    const counting = new Readable({
      read(): void {
        pulled += 1;
        this.push("data");
      },
    }) as unknown as IncomingMessage;
    await readBody(counting, Number.NaN);
    expect(pulled).toBe(0);
  });
});

describe("guardBody", () => {
  it("跨域 403", async () => {
    const res = fakeRes();
    const out = await guardBody(fakeReq({ headers: { "sec-fetch-site": "cross-site" } }), res, {
      maxBytes: 100,
    });
    expect(out).toBeNull();
    expect(res.status).toBe(403);
  });

  it("CSRF 错 403；正确则回 body", async () => {
    const res = fakeRes();
    const token = "t";
    const denied = await guardBody(fakeReq({ headers: { "x-c": "bad" } }), res, {
      maxBytes: 100,
      csrf: { token, headerName: "x-c" },
    });
    expect(denied).toBeNull();
    expect(res.status).toBe(403);
    const ok = await guardBody(fakeReqWithBody("payload", { "x-c": token }), fakeRes(), {
      maxBytes: 100,
      csrf: { token, headerName: "x-c" },
    });
    expect(ok).toBe("payload");
  });

  it("body 超限 413", async () => {
    const res = fakeRes();
    const out = await guardBody(bodyStream("12345"), res, { maxBytes: 2 });
    expect(out).toBeNull();
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, error: "request body too large" });
  });

  it("流中断报 400 而不是冒充 413", async () => {
    const res = fakeRes();
    const errStream = new Readable({
      read(): void {
        this.destroy(new Error("client hung up"));
      },
    }) as unknown as IncomingMessage;
    await expect(guardBody(errStream, res, { maxBytes: 100 })).resolves.toBeNull();
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toStrictEqual({ ok: false, error: "request body unreadable" });
  });

  it("坏预算报 500：那是本端点的配置缺陷，不该冒充客户端的错", async () => {
    const res = fakeRes();
    await expect(guardBody(bodyStream("12345"), res, { maxBytes: Number.NaN })).resolves.toBeNull();
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toStrictEqual({
      ok: false,
      error: "request body limit misconfigured",
    });
  });

  // 下面三条：样板被 6 个包照抄，任何一处口径漂移都是全网一起漂，故钉在公共面而非各包。

  it("省略 csrf 字段 ⇒ 整条 CSRF 检查不执行（GET / 自持 token 端点的既定通路）", async () => {
    // 这是**设计上的放行**，不是漏检：opts.csrf 缺席即不查（模块没有 skipCsrf 开关，
    // 「不查」的唯一写法就是不给这个字段）。所以它必须被钉住——哪天有人把默认改成
    // 「没给 csrf 就拒绝」，等于把所有 GET 端点一起打死；反过来放宽则不会有这种事故，
    // 因为收紧只会让更多请求被拒、不会让本该拒的通过。
    const res = fakeRes();
    await expect(guardBody(bodyStream("payload"), res, { maxBytes: 100 })).resolves.toBe("payload");
    expect(res.status).toBe(0);
    expect(res.body).toBe("");
    // 对照：给了 csrf 但头缺失 ⇒ 403。两条并置才看得出「省略」与「给了但没过」是两回事。
    const guarded = fakeRes();
    await expect(
      guardBody(bodyStream("payload"), guarded, {
        maxBytes: 100,
        csrf: { token: "t", headerName: "x-csrf" },
      }),
    ).resolves.toBeNull();
    expect(guarded.status).toBe(403);
  });

  it("isCrossOrigin：same-site（本机异端口）同样判跨域，不只 cross-site", () => {
    // 白名单只有 same-origin / none；same-site 是本机另一个端口开的页面，能读本机端口的
    // 响应就能发写请求。它必须落进拒绝面，否则 DNS/端口这一维的纵深防御是漏的。
    for (const site of ["same-site", CROSS_SITE, "sandbox", "none-of-these"]) {
      expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": site } }))).toBe(true);
    }
    for (const site of ["same-origin", "none"]) {
      expect(isCrossOrigin(fakeReq({ headers: { "sec-fetch-site": site } }))).toBe(false);
    }
  });

  it("checkCsrf：传入的头名大小写不敏感（Node 的头键一律小写）", () => {
    const token = "t-abc";
    // 头名由调用方传入，而各插件的历史头名各不相同（本包刻意不统一）。调用方照 HTTP
    // 规范写成 X-Csrf-Token 时，直查永远落空——端点从此 100% 403，且看不出跟 CSRF 有关。
    const req = fakeReq({ headers: { "x-csrf-token": token } });
    for (const name of ["x-csrf-token", "X-Csrf-Token", "X-CSRF-TOKEN"]) {
      expect(checkCsrf(req, token, name)).toBe(true);
    }
    // 只折**取键**，不折比对：值仍逐字相等，大小写不同的 token 依旧拒。
    expect(checkCsrf(req, "T-ABC", "X-Csrf-Token")).toBe(false);
  });

  it("readBody：恰好等于限额的一律收下，超出一字节才拒（边界在 ≤ 一侧）", async () => {
    // 判据是 `bytes > maxBytes`。这条把等号那侧钉死：改成 >= 会让正好用满限额的请求
    // 被拒，而限额在文档里的语义是「上限」而不是「独占值」。
    const exact = "x".repeat(64);
    await expect(readBody(bodyStream(exact), 64)).resolves.toStrictEqual({ ok: true, text: exact });
    await expect(readBody(bodyStream(exact), 63)).resolves.toStrictEqual({
      ok: false,
      reason: "too-large",
    });
    // 字节口径（不是字符口径）：4 个汉字 12 字节，限额 11 即拒、限额 12 即收。
    const han = "汉汉汉汉";
    await expect(readBody(bodyStream(han), 12)).resolves.toStrictEqual({ ok: true, text: han });
    await expect(readBody(bodyStream(han), 11)).resolves.toStrictEqual({
      ok: false,
      reason: "too-large",
    });
    // content-length 预检走同一判据，等号那侧同样不拦。
    const declared = fakeReqWithBody(exact, { "content-length": "64" });
    await expect(readBody(declared, 64)).resolves.toStrictEqual({ ok: true, text: exact });
  });
});
